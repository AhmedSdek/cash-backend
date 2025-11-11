const express = require("express");

const router = express.Router();

const Order = require("../models/Order");

const mongoose = require("mongoose");

const requireAuth = require("../middleware/requireAuth");

const User = require("../models/User");

const Shift = require("../models/Shift");

const moment = require("moment");

// =================================================================
// 🟢 ROUTE: جلب الدليفريز التابعين لشيفت معين
// =================================================================
router.get("/shift/:shiftId/deliveries", requireAuth, async (req, res) => {
  try {
    const { shiftId } = req.params;
    let shift;

    if (shiftId === "current") {
      // هات الشيفت الحالي (Open)
      shift = await Shift.findOne({
        tenantId: req.user.tenantId,
        branchId: req.user.branchId,
        status: "OPEN",
      }); // لو مفيش شيفت مفتوح -> رجع 200 مع أري فاضية علشان الـ client ما ياخدش error

      if (!shift) {
        return res.json({ shiftId: "current", deliveries: [] });
      }
    } else {
      // تحقق إن الـ shiftId صالح كـ ObjectId
      if (!mongoose.Types.ObjectId.isValid(shiftId)) {
        return res.status(400).json({ message: "Invalid shiftId" });
      }

      shift = await Shift.findOne({
        _id: shiftId,
        tenantId: req.user.tenantId,
        branchId: req.user.branchId,
      }); // لو المستخدم طلب شيفت معين ومش موجود -> 404

      if (!shift) {
        return res.status(404).json({ message: "الشيفت غير موجود" });
      }
    } // جلب الأوردرات في فترة الشيفت

    const orders = await Order.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      type: "DELIVERY",
      createdAt: shift.closedAt
        ? { $gte: shift.openedAt, $lte: shift.closedAt }
        : { $gte: shift.openedAt },
    }).populate("deliveryId", "name phone"); // استخرج دليفريز مميزة

    const deliveryIds = [
      ...new Set(
        orders
          .filter((o) => o.deliveryId)
          .map((o) => o.deliveryId._id.toString())
      ),
    ]; // لو مفيش دليفريز -> رجع [] (200)

    if (deliveryIds.length === 0) {
      return res.json({
        shiftId: shiftId === "current" ? "current" : shift._id,
        deliveries: [],
      });
    } // جلب بيانات الدليفريز

    const deliveries = await User.find({
      _id: { $in: deliveryIds },
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      role: "DELIVERY",
    }).select("_id name phone status");

    return res.json({
      shiftId: shiftId === "current" ? "current" : shift._id,
      deliveries,
    });
  } catch (err) {
    console.error("Error fetching deliveries for shift:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 🟢 ROUTE: تقرير أداء دليفري في شيفت معين
// =================================================================
const generateDeliveryReport = async (shift, deliveryId, req) => {
  // ✅ هات الأوردرات الخاصة بالدليفري في الشيفت ده
  const orders = await Order.find({
    tenantId: req.user.tenantId,
    branchId: req.user.branchId,
    shiftId: shift._id,
    type: "DELIVERY",
    deliveryId,
  })
    .populate("customerId", "name phone1 phone2 address")
    .populate("cashierId", "name")
    .populate("deliveryId", "name phone");

  const totalOrders = orders.length;
  const totalAmount = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

  const totalDeliveryFees = orders.reduce(
    (sum, o) => sum + (o.deliveryFee || 0),
    0
  );
  const grandTotal = orders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);

  const deliveryInfo = orders.length > 0 ? orders[0].deliveryId : null; // ✅ تحديد حالة المحاسبة: الدليفري تمت محاسبته إذا كانت كل الأوردرات بحالة PAID

  const isSettled = orders.every((o) => o.paymentStatus === "PAID"); // ✅ تحديد حالة الأوردرات التي لم يتم تحصيلها بعد

  const unpaidOrders = orders.filter((o) => o.paymentStatus !== "PAID");
  const totalUnpaid = unpaidOrders.reduce(
    (sum, o) => sum + (o.grandTotal || 0),
    0
  );

  return {
    deliveryId,
    shiftId: shift._id,
    openedAt: shift.openedAt
      ? moment(shift.openedAt).format("YYYY-MM-DD HH:mm:ss")
      : null,
    closedAt: shift.closedAt
      ? moment(shift.closedAt).format("YYYY-MM-DD HH:mm:ss")
      : null,
    totalOrders,
    totalAmount,
    grandTotal,
    totalDeliveryFees,
    totalUnpaid, // ✅ إجمالي غير محصل
    isSettled, // ✅ حالة المحاسبة
    delivery: deliveryInfo
      ? {
          name: deliveryInfo.name,
          phone: deliveryInfo.phone,
        }
      : null,
    orders: orders.map((o) => ({
      orderId: o._id,
      orderNumber: o.orderNumber,
      cashier: o.cashierId?.name || "-",
      customerName: o.customerId?.name || "-",
      customerPhone: o.customerId?.phone1 || "-",
      customerPhone2: o.customerId?.phone2 || "-",
      customerAddress: o.customerId?.address || "-",
      totalPrice: o.totalPrice,
      deliveryFee: o.deliveryFee || 0,
      grandTotal: o.grandTotal || 0,
      status: o.status,
      paymentStatus: o.paymentStatus, // ✅ حالة الدفع
      createdAt: moment(o.createdAt).format("YYYY-MM-DD HH:mm:ss"),
      assignedAt: o.assignedAt
        ? moment(o.assignedAt).format("YYYY-MM-DD HH:mm:ss")
        : null,
      items: o.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
      })),
    })),
  };
};

router.get(
  "/shift/:shiftId/delivery/:deliveryId/report",
  requireAuth,
  async (req, res) => {
    try {
      const { shiftId, deliveryId } = req.params;

      let shift;
      if (shiftId === "current") {
        shift = await Shift.findOne({
          tenantId: req.user.tenantId,
          branchId: req.user.branchId,
          status: "OPEN",
        });
      } else {
        shift = await Shift.findOne({
          _id: shiftId,
          tenantId: req.user.tenantId,
          branchId: req.user.branchId,
        });
      }

      if (!shift) {
        return res.status(404).json({ message: "الشيفت غير موجود" });
      }

      const report = await generateDeliveryReport(shift, deliveryId, req);

      res.json(report);
    } catch (err) {
      console.error("Error generating delivery report:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =================================================================
// 🚀 ROUTE الجديد: إتمام المحاسبة للدليفري (Settle Payments)
// =================================================================
router.put(
  "/shift/:shiftId/delivery/:deliveryId/settle",
  requireAuth,
  async (req, res) => {
    try {
      const { shiftId, deliveryId } = req.params; // ✅ 1. تأكيد الصلاحية (فقط الكاشير أو مدير الفرع يمكنه إتمام المحاسبة)

      if (!["CASHIER", "ADMIN"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Not authorized to settle payments" });
      } // ✅ 2. جلب الشيفت

      let shift;
      const isCurrent = shiftId === "current";

      if (isCurrent) {
        shift = await Shift.findOne({
          tenantId: req.user.tenantId,
          branchId: req.user.branchId,
          status: "OPEN",
        });
      } else {
        shift = await Shift.findOne({
          _id: shiftId,
          tenantId: req.user.tenantId,
          branchId: req.user.branchId,
        });
      }

      if (!shift) {
        return res.status(404).json({ message: "الشيفت غير موجود" });
      } // ✅ 3. جلب الأوردرات المطلوب تحصيلها (المُعينة للدليفري وغير المحصلة)

      const ordersToSettle = await Order.find({
        deliveryId,
        branchId: req.user.branchId,
        shiftId: shift._id, // 🛑 التعديل: نبحث عن الأوردرات التي حالتها DELIVERING أو DELIVERED فقط
        status: { $in: ["DELIVERING", "DELIVERED"] }, // تغطية الحالة أثناء التوصيل وبعده
        paymentStatus: { $ne: "PAID" },
      });

      if (ordersToSettle.length === 0) {
        // إذا لم يكن هناك أوردرات غير محصلة، ربما يكون قد تمت المحاسبة بالفعل
        const report = await generateDeliveryReport(shift, deliveryId, req);
        if (report.isSettled) {
          return res.status(200).json(report); // تم المحاسبة بالفعل
        }
        return res.status(404).json({
          message: "لا توجد طلبات تحتاج إلى تسوية في هذا الشيفت",
        });
      } // ✅ 4. حساب الإجمالي المراد تحصيله (لتحديث الشيفت)

      const totalToCollect = ordersToSettle.reduce(
        (sum, order) => sum + (order.grandTotal || 0),
        0
      ); // ✅ 5. تحديث الأوردرات

      const updateResult = await Order.updateMany(
        {
          _id: { $in: ordersToSettle.map((o) => o._id) },
        },
        {
          $set: {
            paymentStatus: "PAID",
            status: "PAID", // 🛑 التعديل: تحديث حالة الأوردر النهائية إلى PAID
            collectedAt: Date.now(),
            collectedBy: req.user._id, // الكاشير/الأدمن الذي قام بالتسوية
          },
        }
      ); // ✅ 6. تحديث إجمالي الشيفت (إضافة المبلغ إلى خزنة الكاشير الذي قام بالتسوية)

      if (isCurrent && updateResult.modifiedCount > 0) {
        const cashierId = req.user._id.toString();
        const cashierCashIndex = shift.cashes.findIndex(
          (c) => c.userId.toString() === cashierId
        );

        if (cashierCashIndex !== -1) {
          // تحديث خزنة الكاشير
          shift.cashes[cashierCashIndex].totals.delivery += totalToCollect;
          shift.cashes[cashierCashIndex].totals.deliveryOrdersCount +=
            ordersToSettle.length;
          shift.cashes[cashierCashIndex].totals.overall += totalToCollect; // تحديث إجمالي الشيفت الكلي

          shift.totals.delivery += totalToCollect;
          shift.totals.deliveryOrdersCount += ordersToSettle.length;
          shift.totals.overall += totalToCollect;

          await shift.save();
        } else {
          console.warn(
            `Cashier ID ${cashierId} not found in shift cashes array. Totals not updated.`
          );
        }
      } // ✅ 7. إعادة جلب التقرير المحدث وإرساله

      const updatedReport = await generateDeliveryReport(
        shift,
        deliveryId,
        req
      );

      // 🛑 8. التعديل هنا: تغيير حالة الدليفري إلى OUT بعد إتمام المحاسبة
      await User.findByIdAndUpdate(deliveryId, { status: "OUT" });

      res.json(updatedReport);
    } catch (err) {
      console.error("Error settling delivery payments:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =================================================================
// 🟢 ROUTE: جلب كل الأوردرات المعينة لدليفري معين (لم يتم تسليمها بعد)
// =================================================================
router.get("/delivery/:deliveryId/orders", requireAuth, async (req, res) => {
  // ... (نفس الكود السابق)
  // ... (نفس الكود السابق)
  try {
    const { deliveryId } = req.params; // جلب الأوردرات الخاصة بالدليفري وحالته Assigned أو On Delivery // ملاحظة: بما أن الأوردرات ستصبح PAID عند المحاسبة، هذا الاستعلام لا يزال صحيحاً للبحث عن الأوردرات الحالية

    const orders = await Order.find({
      deliveryId,
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: { $in: ["ASSIGNED", "ON_DELIVERY"] },
    }).populate("cashierId", "name");

    const ordersCount = orders.length; // عدد الأوردرات // 🛑 تصحيح: يجب جمع grandTotal (سعر المنتجات + رسوم التوصيل)
    const totalAmount = orders.reduce(
      (sum, order) => sum + (order.grandTotal || 0),
      0
    );

    res.json({ orders, ordersCount, totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 🟢 ROUTE: عودة الدليفري للمقر وتغيير حالته إلى AVAILABLE
// =================================================================
router.put("/:deliveryId/return", requireAuth, async (req, res) => {
  // ... (نفس الكود السابق)
  try {
    const delivery = await User.findOne({
      _id: req.params.deliveryId,
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      role: "DELIVERY",
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    } // مجرد تغيير حالة الدليفري

    delivery.status = "AVAILABLE";
    await delivery.save();

    res.json({
      message: "Delivery returned to available list",
      delivery,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 🟢 ROUTE: التحصيل النقدي من الدليفري (يستخدمه الكاشير)
// =================================================================

router.put("/:deliveryId/collect", requireAuth, async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { shiftId } = req.body; // ✅ 1. تأكيد الصلاحية (كاشير/أدمن الفرع)

    if (!["CASHIER", "ADMIN"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Not authorized to collect money" });
    } // ✅ 2. جلب الشيفت المفتوح (أو المرسل)

    const shift = await Shift.findOne({
      _id: shiftId,
      branchId: req.user.branchId,
      status: "OPEN",
    });
    if (!shift) {
      return res
        .status(400)
        .json({ message: "No open shift found or invalid shiftId" });
    } // ✅ 3. جلب الأوردرات المطلوب تحصيلها من هذا الدليفري // 🛑 التعديل هنا ليتوافق مع مسار Settle (يفضل استخدام مسار Settle)

    const ordersToCollect = await Order.find({
      deliveryId,
      branchId: req.user.branchId,
      shiftId: shift._id,
      status: { $in: ["DELIVERING", "DELIVERED"] }, // تغير من "DELIVERED"
      paymentStatus: "UNPAID",
    });

    if (ordersToCollect.length === 0) {
      return res.status(404).json({
        message: "No unpaid delivered orders found for this delivery man",
      });
    } // ✅ 4. حساب الإجمالي المراد تحصيله

    const totalCollected = ordersToCollect.reduce(
      (sum, order) => sum + (order.grandTotal || 0),
      0
    ); // ✅ 5. تحديث الأوردرات: تغيير حالة الدفع والتحصيل

    const updateResult = await Order.updateMany(
      {
        _id: { $in: ordersToCollect.map((o) => o._id) },
      },
      {
        $set: {
          paymentStatus: "PAID",
          status: "PAID", // حالة نهائية
          cashierId: req.user._id, // الكاشير الذي حَصَّل فعلياً
          collectedAt: Date.now(),
        },
      }
    ); // ✅ 6. تحديث إجمالي الشيفت (إضافة المبلغ إلى خزنة الكاشير)

    const cashierId = req.user._id.toString();
    const cashierCashIndex = shift.cashes.findIndex(
      (c) => c.userId.toString() === cashierId
    );

    if (cashierCashIndex !== -1) {
      // تحديث خزنة الكاشير الخاصة بهذا المستخدم
      shift.cashes[cashierCashIndex].totals.delivery += totalCollected;
      shift.cashes[cashierCashIndex].totals.deliveryOrdersCount +=
        ordersToCollect.length;
      shift.cashes[cashierCashIndex].totals.overall += totalCollected; // تحديث إجمالي الشيفت الكلي

      shift.totals.delivery += totalCollected;
      shift.totals.deliveryOrdersCount += ordersToCollect.length;
      shift.totals.overall += totalCollected;

      await shift.save();
    } else {
      // ملاحظة: لو الكاشير مش موجود في الـ cashes array، المفروض تكون تمت إضافته عند فتح الشيفت
      console.warn(`Cashier ID ${cashierId} not found in shift cashes array.`);
    } // ✅ 7. تغيير حالة الدليفري إلى AVAILABLE

    await User.findByIdAndUpdate(deliveryId, { status: "AVAILABLE" });

    res.json({
      message: "✅ تم التحصيل من الدليفري بنجاح",
      totalCollected,
      updatedOrdersCount: updateResult.modifiedCount,
    });
  } catch (err) {
    console.error("Error collecting from delivery:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 📌 ROUTE: Dashboard للدليفريز
// =================================================================
router.get("/delivery-dashboard", requireAuth, async (req, res) => {
  // ... (نفس الكود السابق)
  // ... (نفس الكود السابق)
  try {
    // 👷‍♂️ هات كل الدليفريز
    const deliveries = await User.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      role: "DELIVERY",
    });

    const availableDeliveries = [];
    const busyDeliveries = [];
    const outDeliveries = [];

    for (const d of deliveries) {
      let deliveryData = { ...d.toObject() }; // ⏱️ لو مشغول احسب الوقت من busySince

      if (d.status === "BUSY" && d.busySince) {
        const diffMs = Date.now() - new Date(d.busySince).getTime();
        deliveryData = {
          ...deliveryData,
          busySince: d.busySince,
          elapsedMinutes: Math.floor(diffMs / 1000 / 60),
          elapsedSeconds: Math.floor(diffMs / 1000),
        };
        busyDeliveries.push(deliveryData);
      } else if (d.status === "OUT") {
        outDeliveries.push(deliveryData);
      } else if (d.status === "AVAILABLE") {
        availableDeliveries.push(deliveryData);
      }
    }

    res.json({
      availableDeliveries,
      busyDeliveries,
      outDeliveries,
    });
  } catch (err) {
    console.error("❌ Error in delivery-dashboard:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 🟢 ROUTE: جلب الدليفريز بحالة OUT لفرع معين
// =================================================================
router.get(
  "/branch/:branchId/out-deliveries",
  requireAuth,
  async (req, res) => {

    try {
      const { branchId } = req.params;

      const deliveries = await User.find({
        branchId,
        role: "DELIVERY",
        status: "OUT",
        isActive: true, // لو عايز تتأكد إنه مش متوقف
      }).select("name phone status");

      res.json(deliveries);
    } catch (err) {
      console.error("Error fetching out deliveries:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =================================================================
// 🟢 ROUTE: إعادة حالة الدليفري إلى AVAILABLE يدوياً
// =================================================================
router.put("/:deliveryId/set-available", requireAuth, async (req, res) => {
  // ... (نفس الكود السابق)
  // ... (نفس الكود السابق)
  try {
    const { deliveryId } = req.params;

    const delivery = await User.findOneAndUpdate(
      { _id: deliveryId, role: "DELIVERY" },
      { status: "AVAILABLE" },
      { new: true }
    ).select("name phone status");

    if (!delivery) {
      return res.status(404).json({ message: "الدليفري غير موجود" });
    }

    res.json({ message: "تم تحديث حالة الدليفري", delivery });
  } catch (err) {
    console.error("Error updating delivery status:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
