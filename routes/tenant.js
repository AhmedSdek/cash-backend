// routes/tenant.js
const express = require("express");
const router = express.Router();
const Tenant = require("../models/Tenant");
const requireAuth = require("../middleware/requireAuth");
const { requireOwner } = require("../middleware/requireOwner");
const User = require("../models/User");
const Branch = require("../models/Branch");

// Get all tenants (developer only)

router.get("/all-tenants", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "DEVELOPER") {
      return res.status(403).json({ message: "Access denied" });
    }

    const tenants = await Tenant.find(); // كل المطاعم
    res.json(tenants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// تعديل بيانات مطعم (مثلاً تغيير isActive)
router.patch("/:tenantId", requireAuth, requireOwner, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const updates = req.body; // مثلا { isActive: false }

    // ✅ تحديث التينانت
    const updatedTenant = await Tenant.findByIdAndUpdate(tenantId, updates, {
      new: true,
    });

    if (!updatedTenant)
      return res.status(404).json({ message: "Tenant not found" });

    // ✅ لو البلوك أو التفعيل اتغير، عدل كل اليوزرز تبع التينانت
    if (typeof updates.isActive !== "undefined") {
      await User.updateMany(
        { tenantId: tenantId },
        { $set: { isActive: updates.isActive } }
      );
    }

    res.json({ message: "Tenant updated", tenant: updatedTenant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ جلب كل الفروع الخاصة بالـ Tenant
router.get("/branches", requireAuth, async (req, res) => {
  try {
    const { role, tenantId, branchId } = req.user;

    // ✅ السماح للأدوار المطلوبة فقط
    if (!["OWNER", "CALL_CENTER_ADMIN", "CALL_CENTER_USER"].includes(role)) {
      return res.status(403).json({ message: "غير مسموح لك بمشاهدة الفروع" });
    }

    let branches;

    // 🟩 OWNER أو CALL_CENTER_ADMIN → كل الفروع
    if (
      role === "OWNER" ||
      role === "CALL_CENTER_ADMIN" ||
      role === "CALL_CENTER_USER"
    ) {
      branches = await Branch.find({ tenantId });
    }

    res.json(branches);
  } catch (err) {
    console.error("Error fetching branches:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🟢 إضافة فرع جديد
router.post("/branche/add", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "غير مسموح" });
    }

    const { name, address, phone } = req.body;

    if (!req.user.tenantId) {
      return res.status(400).json({ message: "Tenant ID مفقود" });
    }

    // تحقق إذا كان الفرع موجود بالفعل عند نفس التينانت
    const existingBranch = await Branch.findOne({
      tenantId: req.user.tenantId,
      name: name,
    });

    if (existingBranch) {
      return res.status(400).json({ message: "الفرع بهذا الاسم موجود بالفعل" });
    }

    // إنشاء فرع جديد
    const branch = await Branch.create({
      tenantId: req.user.tenantId,
      name,
      address,
      phone,
    });

    res.status(201).json({ message: "تم إضافة الفرع بنجاح", branch });
  } catch (err) {
    console.error("❌ Error adding branch:", err);
    res.status(500).json({ message: "حدث خطأ أثناء إضافة الفرع" });
  }
});
// 🟡 تعديل فرع
router.patch("/branche/:branchId", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "غير مسموح" });
    }
    console.log(req.body);

    const { branchId } = req.params;
    console.log(branchId);
    const { name, address, phone } = req.body;
    console.log(name, address, phone);

    const updatedBranch = await Branch.findOneAndUpdate(
      { _id: branchId, tenantId: req.user.tenantId },
      { name, address, phone },
      { new: true }
    );

    if (!updatedBranch) {
      return res.status(404).json({ message: "الفرع غير موجود" });
    }

    res.json({ message: "تم تعديل الفرع بنجاح", branch: updatedBranch });
  } catch (err) {
    console.error("❌ Error updating branch:", err);
    res.status(500).json({ message: "حدث خطأ أثناء تعديل الفرع" });
  }
});

// 🟢 جلب الفرع الخاص باليوزر الحالي
router.get("/my-branch", requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // نجيب اليوزر عشان نعرف الـ branchId
    const user = await User.findById(userId);

    if (!user || !user.branchId) {
      return res.status(404).json({ message: "اليوزر مش مرتبط بأي فرع" });
    }

    // نجيب بيانات الفرع
    const branch = await Branch.findById(user.branchId);

    if (!branch) {
      return res.status(404).json({ message: "الفرع غير موجود" });
    }

    res.json(branch);
  } catch (err) {
    console.error("❌ Error fetching user branch:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
