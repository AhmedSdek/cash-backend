// routes/user.js
const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const Order = require("../models/Order");
const User = require("../models/User");

// 🔹 تقرير الكاشير مع تفاصيل TAKEAWAY و DELIVERY
router.get("/with-orders", requireAuth, async (req, res) => {
  try {
    const { tenantId, branchId } = req.user;

    const usersWithOrders = await Order.aggregate([
      { $match: { tenantId, branchId } }, // فقط البرنش الحالي
      {
        $group: {
          _id: { cashierId: "$cashierId", type: "$type" },
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: "$totalPrice" },
        },
      },
      {
        $group: {
          _id: "$_id.cashierId",
          orders: {
            $push: {
              type: "$_id.type",
              totalOrders: "$totalOrders",
              totalAmount: "$totalAmount",
            },
          },
          totalOrdersAll: { $sum: "$totalOrders" },
          totalAmountAll: { $sum: "$totalAmount" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: "$user._id",
          name: "$user.name",
          email: "$user.email",
          orders: 1,
          totalOrdersAll: 1,
          totalAmountAll: 1,
        },
      },
      { $sort: { name: 1 } },
    ]);

    res.json(usersWithOrders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/all", requireAuth, async (req, res) => {
  try {
    const { role, tenantId, branchId } = req.user;
    const { selectedBranch } = req.query; // 👈 اختيار فرع معين من الكلاينت (اختياري)

    let filter = { tenantId };

    // ✅ OWNER → كل المستخدمين أو فرع محدد لو اختار
    if (role === "OWNER") {
      if (selectedBranch) {
        filter.branchId = selectedBranch;
      }
    }

    // ✅ ADMIN → المستخدمين داخل نفس الفرع فقط
    else if (role === "ADMIN") {
      filter.branchId = branchId;
    }

    // ✅ CALL_CENTER_ADMIN → المستخدمين اللي رولهم كول سنتر فقط
    else if (role === "CALL_CENTER_ADMIN") {
      filter.role = { $in: ["CALL_CENTER_ADMIN", "CALL_CENTER_USER"] };
    }

    // ❌ أي رول تاني غير مسموح
    else {
      return res.status(403).json({ message: "غير مسموح" });
    }

    // ✅ جلب المستخدمين مع اسم الفرع
    const users = await User.find(filter).populate("branchId", "name"); // يجيب اسم الفرع بدل الـ id
    // console.log(users);

    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =============================
// 🔹 تعديل بيانات المستخدم
// =============================
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { role, tenantId, branchId } = req.user;
    const { id } = req.params;
    const { name, email, phone, userRole, status } = req.body;

    // نجيب المستخدم اللي هيتم تعديله
    const targetUser = await User.findById(id);
    if (!targetUser) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // التحقق من الصلاحيات
    if (role === "OWNER") {
      // صاحب التينانت يقدر يعدل على أي مستخدم داخل التينانت بتاعه
      if (targetUser.tenantId.toString() !== tenantId.toString()) {
        return res
          .status(403)
          .json({ message: "غير مسموح بالتعديل خارج التينانت" });
      }
    } else if (role === "ADMIN") {
      // الأدمن يقدر يعدل فقط على المستخدمين اللي في نفس الفرع
      if (targetUser.branchId?.toString() !== branchId?.toString()) {
        return res
          .status(403)
          .json({ message: "غير مسموح بالتعديل خارج الفرع" });
      }
    } else if (role === "CALL_CENTER_ADMIN") {
      // كول سنتر أدمن يقدر يعدل فقط على كول سنتر يوزرس
      if (targetUser.role !== "CALL_CENTER_USER") {
        return res
          .status(403)
          .json({ message: "غير مسموح بالتعديل على هذا المستخدم" });
      }
    } else {
      // أي دور تاني غير مسموح بالتعديل
      return res.status(403).json({ message: "غير مسموح" });
    }

    // التعديل
    const updatedUser = await User.findOneAndUpdate(
      { _id: id },
      { name, email, phone, role: userRole, status },
      { new: true, runValidators: true }
    ).select("-password");

    res.json(updatedUser);
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =============================
// 🔹 حذف المستخدم
// =============================
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { role, tenantId } = req.user;

    // بس الـ OWNER هو اللي يقدر يحذف
    if (role !== "OWNER" && role !== "ADMIN" && role !== "CALL_CENTER_ADMIN") {
      return res.status(403).json({ message: "غير مسموح" });
    }

    const { id } = req.params;

    const deletedUser = await User.findOneAndDelete({ _id: id, tenantId });

    if (!deletedUser) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    res.json({ message: "تم حذف المستخدم بنجاح" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ message: "Server error" });
  }
});
module.exports = router;
