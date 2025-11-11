const express = require("express");
const Shift = require("../models/Shift");
const Order = require("../models/Order");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const Counter = require("../models/Counter");

const router = express.Router();

// ----------------------------------------------------
// GET /api/shifts -> جلب كل الشيفتات
router.get("/", requireAuth, async (req, res) => {
  try {
    const shifts = await Shift.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
    }).sort({ openedAt: -1 }); // الترتيب من الأحدث للأقدم

    res.json({ shifts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/shifts/current -> جلب الشيفت المفتوح الحالي + جميع أوردرات الدليفري المرتبطة
router.get("/current", requireAuth, async (req, res) => {
  try {
    // 1. جلب الشيفت المفتوح
    const shift = await Shift.findOne({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: "OPEN",
    })
      .populate("openedBy", "name phone role")
      .populate("cashes.userId", "name phone");

    // 3. إرجاع البيانات في الرد
    res.json({
      shift: shift || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------------------------------------
// PUT /api/shifts/close -> اغلاق الشيفت الحالي
router.put("/close", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admin can close shift" });
    } // 🟢 هات الشيفت المفتوح

    const shift = await Shift.findOne({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: "OPEN",
    });

    if (!shift) {
      return res.status(400).json({ message: "No open shift found" });
    } // 🟢 هات الأوردرات بتاعة الشيفت ده

    const orders = await Order.find({ shiftId: shift._id }); // ⚠️ التحقق الجديد: لو في أوردر دليفري UNPAID (لم يتم تحصيله)، لا يمكن الإغلاق

    const uncollectedDeliveryOrder = orders.find(
      (o) => o.type === "DELIVERY" && o.paymentStatus === "UNPAID"
    );

    if (uncollectedDeliveryOrder) {
      return res.status(400).json({
        message: `Cannot close shift. Delivery order ${uncollectedDeliveryOrder.orderNumber} is UNPAID.`,
      });
    } // 🧮 حساب الإجماليات: نحسب فقط الأوردرات المدفوعة (PAID)

    let takeawayTotal = 0,
      deliveryTotal = 0,
      takeawayOrdersCount = 0,
      deliveryOrdersCount = 0;

    for (let order of orders) {
      if (order.paymentStatus === "PAID") {
        if (order.type === "TAKEAWAY") {
          takeawayTotal += order.totalPrice || 0;
          takeawayOrdersCount++;
        } else if (order.type === "DELIVERY") {
          // Grand Total = totalPrice + deliveryFee
          deliveryTotal += (order.totalPrice || 0) + (order.deliveryFee || 0);
          deliveryOrdersCount++;
        }
      }
    } // ❌ جعل حالة كل الدليفريهات في الفرع "OUT"

    await User.updateMany(
      {
        tenantId: req.user.tenantId,
        branchId: req.user.branchId,
        role: "DELIVERY",
      },
      { $set: { status: "OUT" } }
    ); // 🟢 اقفل الشيفت

    shift.status = "CLOSED";
    shift.closedAt = new Date();
    shift.closedBy = req.user._id;
    shift.totals = {
      takeaway: takeawayTotal,
      takeawayOrdersCount,
      delivery: deliveryTotal,
      deliveryOrdersCount,
      overall: takeawayTotal + deliveryTotal,
    };
    await shift.save(); // 🔥 تصفير العداد بتاع الأوردرات للشيفت الجديد

    await Counter.findOneAndUpdate(
      {
        tenantId: req.user.tenantId,
        branchId: req.user.branchId,
        name: "orderNumber",
      },
      { $set: { seq: 0 } }
    );

    res.json({ message: "Shift closed successfully", shift });
  } catch (err) {
    console.error("❌ Error closing shift:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------------------------------------
// GET /api/shifts/:id/report -> جلب تقرير الشيفت
router.get("/:id/report", requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id).populate("openedBy", "name phone role")
      .populate("cashes.userId", "name phone");
    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    } // ✅ هنا بيرجع الشيفت كامل زي ما هو متخزن ف الداتابيز

    res.json(shift);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------------------------------------
// GET /api/shifts/shifts -> جلب الشيفتات المفتوحة والمغلقة (ملخص)
router.get("/shifts", requireAuth, async (req, res) => {
  try {
    // 🟢 هات الشيفت الحالي (Open)
    const currentShift = await Shift.findOne({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: "OPEN",
    }).select("_id openedAt"); // 🟢 هات الشيفتات المقفولة

    const closedShifts = await Shift.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: "CLOSED",
    }).select("_id openedAt closedAt");

    res.json({ currentShift, closedShifts });
  } catch (err) {
    console.error("Error fetching shifts:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
