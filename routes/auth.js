const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const Branch = require("../models/Branch");
const requireAuth = require("../middleware/requireAuth");
const sendMail = require("../utils/sendEmail");

const router = express.Router();

// ✅ طلب إعادة تعيين الباسورد
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // نولد JWT reset token صالح لمدة ساعة
    const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // لينك الريست
    const resetUrl = `http://localhost:5173/reset-password/${resetToken}`;

    // ابعت الميل
    await sendMail(
      user.email,
      "Password Reset",
      `اضغط على اللينك لتغيير الباسورد: ${resetUrl}`
    );

    res.json({ message: "Reset link sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ إعادة تعيين الباسورد
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // تحقق من صحة التوكين
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // هات اليوزر
    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // غير الباسورد
    const hashedPassword = await bcrypt.hash(password, 10);
    user.passwordHash = hashedPassword;
    await user.save();

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ✅ Register Tenant (إنشاء مطعم جديد + أول فرع + أدمن)
 */
router.post("/register-tenant", requireAuth, async (req, res) => {
  try {
    // ✅ بس الـ DEVELOPER هو اللي يقدر يسجل tenant جديد
    if (req.user.role !== "DEVELOPER") {
      return res.status(403).json({
        message: "Access denied. Only DEVELOPER can register a tenant.",
      });
    }

    const { tenantName, branchName, adminName, email, password } = req.body;
    console.log({ tenantName, branchName, adminName, email, password });

    // ✅ التحقق من وجود مستخدم بنفس الإيميل
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "البريد الإلكتروني مستخدم بالفعل" });
    }

    // ✅ إنشاء tenant جديد
    const tenant = await Tenant.create({ name: tenantName, email });

    // ✅ إنشاء أول فرع (ممكن تزود فروع بعدين)
    const branch = await Branch.create({
      tenantId: tenant._id,
      name: branchName || "Main Branch",
    });

    // ✅ عمل hash للباسورد
    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ إنشاء OWNER مربوط بالـ tenant فقط (مش فرع محدد)
    const owner = await User.create({
      name: adminName,
      email,
      passwordHash,
      role: "OWNER",
      tenantId: tenant._id,
      branchId: null, // 🔥 صاحب المطعم مش مربوط بفرع معين
    });

    res.status(201).json({
      message: "تم تسجيل المطعم بنجاح",
      tenant,
      branch,
      owner,
    });
  } catch (err) {
    console.error(err);
    // ✅ معالجة خطأ Duplicate Key بشكل صريح
    if (err.code === 11000 && err.keyValue?.email) {
      return res
        .status(400)
        .json({ message: "البريد الإلكتروني مستخدم بالفعل" });
    }
    res.status(500).json({ message: "حدث خطأ في السيرفر" });
  }
});

// تسجيل يوزر جديد
router.post("/register-user", requireAuth, async (req, res) => {
  try {
    const { name, email, password, phone, role, branchId } = req.body;
    const requesterRole = req.user.role;
    const tenantId = req.user.tenantId;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // ✅ تحديد الأدوار المسموح بها حسب دور الشخص اللي بيضيف
    let allowedRoles = [];
    if (requesterRole === "OWNER") {
      allowedRoles = [
        "ADMIN",
        "CASHIER",
        "DELIVERY",
        "CALL_CENTER_ADMIN",
        "CALL_CENTER_USER",
      ];
    } else if (requesterRole === "ADMIN") {
      allowedRoles = ["CASHIER", "DELIVERY"];
    } else if (requesterRole === "CALL_CENTER_ADMIN") {
      allowedRoles = ["CALL_CENTER_USER"]; // ✅ التعديل هنا
    } else {
      return res.status(403).json({ message: "Not authorized to add users" });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role for your level" });
    }

    // ✅ تحديد الفرع (نفس المنطق)
    let finalBranchId = null;
    if (["ADMIN", "CASHIER", "DELIVERY"].includes(role)) {
      if (requesterRole === "ADMIN") {
        finalBranchId = req.user.branchId;
      } else {
        if (!branchId)
          return res
            .status(400)
            .json({ message: `${role} must be assigned to a branch` });
        const branch = await Branch.findOne({ _id: branchId, tenantId });
        if (!branch)
          return res
            .status(404)
            .json({ message: "Branch not found for this tenant" });
        finalBranchId = branchId;
      }
    } else {
      if (branchId)
        return res
          .status(400)
          .json({ message: `${role} should not be assigned to a branch` });
    }

    // ✅ تحقق من البيانات حسب الدور
    if (role !== "DELIVERY") {
      if (!email || !password) {
        return res
          .status(400)
          .json({ message: `${role} requires email and password` });
      }
      const existingEmail = await User.findOne({ email });
      if (existingEmail)
        return res.status(400).json({ message: "Email already exists" });
    } else {
      if (!name || !phone) {
        return res
          .status(400)
          .json({ message: "Delivery requires name and phone number" });
      }
      const existingPhone = await User.findOne({ phone, role: "DELIVERY" });
      if (existingPhone)
        return res.status(400).json({ message: "Phone already exists" });
    }

    // ✅ تشفير الباسورد
    let passwordHash = null;
    if (password && role !== "DELIVERY") {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // ✅ إنشاء المستخدم
    const userData = {
      name,
      role,
      tenantId,
      branchId: finalBranchId,
    };
    if (role !== "DELIVERY") {
      userData.email = email;
      userData.passwordHash = passwordHash;
    }
    if (phone && role === "DELIVERY") userData.phone = phone;

    const user = await User.create(userData);

    res.status(201).json({ message: "User created successfully", user });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ✅ Login (ADMIN / CASHIER فقط)
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ check user
    const user = await User.findOne({ email }).populate("branchId");
    console.log(user)
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    // ✅ check if blocked
    if (!user.isActive) {
      return res
        .status(403)
        .json({ message: "هذا الحساب محظور، برجاء التواصل مع الإدارة" });
    }

    // ✅ منع الدليفري من تسجيل الدخول
    if (user.role === "DELIVERY") {
      return res
        .status(403)
        .json({ message: "Delivery users cannot login to the system" });
    }

    // ✅ check password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials" });

    // ✅ generate token
    const token = jwt.sign(
      {
        sub: user._id,
        role: user.role,
        tenantId: user.tenantId,
        branchId: user.branchId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
