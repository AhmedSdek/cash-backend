// routes/orderRoutes.js
const express = require("express");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const Shift = require("../models/Shift");
const Counter = require("../models/Counter");
const Customer = require("../models/Customer");
const router = express.Router();
const mongoose = require("mongoose");

// =================================================================
// 🟢 إنشاء أوردر جديد
// =================================================================
router.post("/", requireAuth, async (req, res) => {
  const session = await mongoose.startSession(); // تغيير startSession من Shift
  session.startTransaction();

  try {
    const { type, items, customerId, branchId: bodyBranchId } = req.body;
    const isCallCenter = ["CALL_CENTER_ADMIN", "CALL_CENTER_USER"].includes(
      req.user.role
    ); // يفتح خزنة شخصية فقط إذا كان كاشير و الأوردر Takeaway
    const shouldHaveCashbox = !isCallCenter && type === "TAKEAWAY";

    if (!["TAKEAWAY", "DELIVERY"].includes(type)) {
      return res.status(400).json({ message: "Invalid order type" });
    }

    if (!items || !items.length) {
      return res.status(400).json({ message: "Order items required" });
    } // تحديد الفرع حسب دور المستخدم

    const branchId = isCallCenter ? bodyBranchId : req.user.branchId;

    if (!branchId) {
      return res.status(400).json({ message: "branchId مطلوب لإنشاء الأوردر" });
    } // 1. البحث عن/فتح الشيفت الحالي

    let shift = await Shift.findOne({
      tenantId: req.user.tenantId,
      branchId,
      status: "OPEN",
    }).session(session);

    if (!shift) {
      const newShift = {
        tenantId: req.user.tenantId,
        branchId,
        openedBy: req.user._id,
        status: "OPEN",
        totals: {
          takeaway: 0,
          takeawayOrdersCount: 0,
          delivery: 0,
          deliveryOrdersCount: 0,
          overall: 0,
        },
        cashes: [],
      };
      shift = await Shift.create([newShift], { session });
      shift = shift[0];
    } // 2. منطق فتح/البحث عن الخزنة الشخصية

    let cashbox = null;
    let cashierIdToUse = req.user._id;

    if (shouldHaveCashbox) {
      // البحث عن الخزنة
      cashbox = shift.cashes.find(
        (c) =>
          c.userId.toString() === req.user._id.toString() && c.status === "OPEN"
      ); // فتح خزنة جديدة إذا لم توجد

      if (!cashbox) {
        const newCashbox = {
          userId: req.user._id,
          openedAt: new Date(),
          totals: {
            takeaway: 0,
            takeawayOrdersCount: 0,
            delivery: 0,
            deliveryOrdersCount: 0,
            overall: 0,
          },
          status: "OPEN",
        };
        shift.cashes.push(newCashbox);
        await shift.save({ session }); // تحديث كائن الشيفت بعد الحفظ للحصول على الـ ID الخاص بالـ cashes
        shift = await Shift.findById(shift._id).session(session);
        cashbox = shift.cashes.find(
          (c) =>
            c.userId.toString() === req.user._id.toString() &&
            c.status === "OPEN"
        );
      }
      cashierIdToUse = req.user._id; // الكاشير الفعلي هو المستخدم الحالي
    } else {
      // إذا كان كول سنتر أو أوردر دليفري، يتم استخدام منشئ الأوردر كـ cashierId
      cashierIdToUse = req.user._id;
    } // حساب الأوردرات

    let orderItems = [];
    let totalPrice = 0; // إجمالي سعر الأصناف

    for (let item of items) {
      const product = await Product.findOne({
        _id: item.productId,
        tenantId: req.user.tenantId,
        branchId,
      }).session(session);

      if (!product) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ message: `Product not found: ${item.productId}` });
      }

      const lineTotal = product.price * item.quantity;
      totalPrice += lineTotal;
      orderItems.push({
        productId: product._id,
        name: product.name,
        quantity: item.quantity,
        price: product.price,
        total: lineTotal,
      });
    } // جلب/زيادة عداد الأوردر

    const counter = await Counter.findOneAndUpdate(
      { branchId, shiftId: shift._id },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    const nextOrderNumber = counter.seq; // حساب رسوم التوصيل

    let deliveryFee = 0;
    let zoneId = null;

    if (type === "DELIVERY" && customerId) {
      const populatedCustomer = await Customer.findById(customerId)
        .populate("zoneId")
        .session(session);

      if (!populatedCustomer) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Customer not found" });
      }

      deliveryFee = populatedCustomer.zoneId?.deliveryFee || 0;
      zoneId = populatedCustomer.zoneId?._id || null;
    } // 🛑 إضافة grandTotal: إجمالي سعر الأصناف + رسوم التوصيل

    const grandTotal = totalPrice + deliveryFee;

    const orderData = {
      tenantId: req.user.tenantId,
      branchId,
      shiftId: shift._id,
      cashierId: cashierIdToUse,
      type,
      items: orderItems,
      totalPrice,
      deliveryFee,
      grandTotal, // 🔑 إضافة grandTotal
      zoneId,
      status: type === "DELIVERY" ? "NEW" : "PAID",
      paymentStatus: type === "DELIVERY" ? "UNPAID" : "PAID",
      collectedAt: type === "TAKEAWAY" ? new Date() : undefined,
      orderNumber: nextOrderNumber,
      createdBy: req.user._id,
      source: isCallCenter ? "CALL_CENTER" : "CASHIER",
      customerId: customerId || undefined,
    };

    const order = await Order.create([orderData], { session });
    const createdOrder = order[0]; // 3. تحديث الشيفت العام (ALWAYS)

    if (type === "TAKEAWAY") {
      shift.totals.takeaway += grandTotal; // Takeaway grandTotal = totalPrice
      shift.totals.takeawayOrdersCount += 1;
    } else if (type === "DELIVERY") {
      // 🛑 تصحيح: يتم تحديث توتال الدليفري بـ grandTotal
      shift.totals.delivery += grandTotal;
      shift.totals.deliveryOrdersCount += 1;
    }
    shift.totals.overall += grandTotal; // 4. تحديث الخزنة الشخصية (ONLY FOR CASHIER TAKEAWAY)

    if (cashbox) {
      // cashbox موجود فقط إذا كان shouldHaveCashbox صحيحاً
      const cashboxIdx = shift.cashes.findIndex((c) =>
        c._id.equals(cashbox._id)
      );

      if (type === "TAKEAWAY") {
        // الكاشير يحصل grandTotal اللي هو هنا totalPrice
        shift.cashes[cashboxIdx].totals.takeaway += grandTotal;
        shift.cashes[cashboxIdx].totals.takeawayOrdersCount += 1;
      } // لا يتم تحديث توتال الدليفري هنا - يتم تحديثه في روت التحصيل
      shift.cashes[cashboxIdx].totals.overall += grandTotal;
    }

    await shift.save({ session });

    await session.commitTransaction();
    session.endSession(); // ✅ Populate شامل قبل الإرسال

    const populatedOrder = await Order.findById(createdOrder._id)
      .populate({
        path: "customerId",
        populate: { path: "zoneId" },
      })
      .populate("items.productId", "name price")
      .populate("deliveryId", "name phone")
      .populate("branchId", "name")
      .populate("tenantId", "name")
      .populate("createdBy", "name")
      .populate("zoneId"); // 🟢 إشعار جديد

    if (global.notifyOrder) {
      global.notifyOrder({
        branchId,
        tenantId: req.user.tenantId,
        order: populatedOrder,
        eventType: "NEW", // تحديد نوع الحدث: جديد
      });
    }

    res.status(201).json({
      message: "Order created",
      order: populatedOrder,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error creating order:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// ✅ تخصيص أوردر لدليفري (رفع أكتر من أوردر)
// =================================================================
router.put("/assign-multiple-delivery", requireAuth, async (req, res) => {
  try {
    const { orderIds, deliveryId } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res
        .status(400)
        .json({ message: "orderIds is required and must be an array" });
    } // 1. تحقق من وجود الدليفري

    const delivery = await User.findOne({
      _id: deliveryId,
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      role: "DELIVERY",
    });

    if (!delivery) {
      return res.status(400).json({ message: "Invalid delivery user" });
    } // 2. نجيب الأوردرات المتاحة للرفع

    const orders = await Order.find({
      _id: { $in: orderIds },
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      type: "DELIVERY",
      status: { $in: ["NEW", "PREPARING", "READY"] },
    });

    if (orders.length === 0) {
      return res.status(404).json({ message: "No valid orders found" });
    } // 3. نحدث الأوردرات ونرسل الإشعارات

    const updatedOrders = [];
    for (const order of orders) {
      order.deliveryId = delivery._id;
      order.status = "DELIVERING";
      order.assignedAt = new Date();
      await order.save(); // ✅ الإشعار لكل أوردر

      const populatedOrder = await Order.findById(order._id)
        .populate({ path: "customerId", populate: { path: "zoneId" } })
        .populate("items.productId", "name price")
        .populate("deliveryId", "name phone")
        .populate("branchId", "name")
        .populate("tenantId", "name")
        .populate("createdBy", "name")
        .populate("zoneId");

      if (global.notifyOrder) {
        global.notifyOrder({
          branchId: order.branchId.toString(),
          tenantId: order.tenantId.toString(),
          order: populatedOrder,
          eventType: "UPDATE",
        });
      }
      updatedOrders.push(populatedOrder);
    } // 4. تحديث حالة ووقت الدليفري

    delivery.status = "BUSY";
    delivery.busySince = new Date();
    await delivery.save();

    res.json({
      message: "Orders assigned successfully",
      delivery,
      updatedOrders,
    });
  } catch (err) {
    console.error("❌ Error in assign-multiple-delivery:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// ✅ إلغاء رفع أوردر من دليفري (لأكتر من أوردر)
// =================================================================
router.put("/unassign-multiple", requireAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "لازم تبعت مصفوفة orderIds" });
    } // جلب الأوردرات قبل التعديل

    const orders = await Order.find({
      _id: { $in: orderIds },
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      type: "DELIVERY",
      status: "DELIVERING",
    }).populate("customerId deliveryId");

    if (orders.length === 0) {
      return res.status(404).json({ message: "مفيش أوردرات متاحة للإلغاء" });
    }

    const updatedOrders = [];
    for (let order of orders) {
      order.deliveryId = null;
      order.status = "NEW"; // العودة إلى حالة NEW
      order.assignedAt = null;
      await order.save(); // 2. عمل Populate شامل

      const populatedOrder = await Order.findById(order._id)
        .populate({ path: "customerId", populate: { path: "zoneId" } })
        .populate("items.productId", "name price")
        .populate("deliveryId", "name phone")
        .populate("branchId", "name")
        .populate("tenantId", "name")
        .populate("createdBy", "name")
        .populate("zoneId"); // 3. إرسال الإشعار للجميع

      if (global.notifyOrder) {
        global.notifyOrder({
          branchId: populatedOrder.branchId._id.toString(),
          tenantId: populatedOrder.tenantId._id.toString(),
          order: populatedOrder,
          eventType: "UPDATE",
        });
      }

      updatedOrders.push(populatedOrder);
    } // 4. لا يوجد تحديث لحالة الدليفري هنا - يفترض أن يتم التعامل معه في روت آخر إذا انتهت جميع طلباته
    res.json({
      message: ` تم إلغاء رفع ${updatedOrders.length} أوردر بنجاح`,
      orders: updatedOrders,
    });
  } catch (err) {
    console.error("❌ Error in unassign-multiple:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// =================================================================
// ✅ الأوردرات اللي لسه متعملهاش Assign
// =================================================================
router.get("/unassigned-delivery", requireAuth, async (req, res) => {
  try {
    const { role, tenantId, branchId } = req.user;
    const { branch } = req.query; // بناء الفلتر الأساسي

    let filter = {
      tenantId,
      type: "DELIVERY",
      $or: [{ deliveryId: null }, { deliveryId: { $exists: false } }],
      status: { $in: ["NEW", "PREPARING", "READY"] },
    }; // ✅ لو اليوزر CALL_CENTER_ADMIN أو CALL_CENTER_USER يقدر يختار الفرع

    if (role === "CALL_CENTER_ADMIN" || role === "CALL_CENTER_USER") {
      if (branch && branch !== "all") {
        filter.branchId = branch;
      }
    } else {
      // ✅ اليوزر العادي يشوف فرعه فقط
      filter.branchId = branchId;
    }

    const orders = await Order.find(filter)
      .populate({
        path: "customerId",
        populate: { path: "zoneId" },
      })
      .populate("items.productId", "name price")
      .populate("branchId", "name")
      .populate("createdBy", "name");

    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// ✅ جلب الأوردرات المرفوعة للشيفت المفتوح فقط
// =================================================================
router.get("/assigned-delivery", requireAuth, async (req, res) => {
  try {
    const openShift = await Shift.findOne({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      status: "OPEN",
    });

    if (!openShift) {
      return res.json([]); // مفيش شيفت مفتوح
    }

    const orders = await Order.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      type: "DELIVERY",
      status: "DELIVERING",
      shiftId: openShift._id,
    })
      .populate("customerId")
      .populate("deliveryId", "name phone")
      .populate("items.productId", "name price");

    res.json(orders);
  } catch (err) {
    console.error("Error fetching assigned orders:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// 🟡 تعديل أوردر
// =================================================================
router.put("/:orderId", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body || {};
    const { customerId } = updates; // ممكن يتم تحديث العميل // ✅ الفرع اللي هيتأثر

    const branchId =
      req.user.role === "CALL_CENTER_ADMIN" ||
        req.user.role === "CALL_CENTER_USER"
        ? updates.branchId
        : req.user.branchId;

    let order = await Order.findOne({
      _id: orderId,
      tenantId: req.user.tenantId,
      branchId,
    });

    if (!order) {
      return res.status(404).json({ message: "الاوردر غير موجود" });
    } // ✅ لو فيه تعديل في الأصناف

    if (Array.isArray(updates.items) && updates.items.length > 0) {
      let totalPrice = 0;
      let newItems = [];

      for (let item of updates.items) {
        const product = await Product.findOne({
          _id: item.productId,
          tenantId: req.user.tenantId,
          branchId,
        });

        if (!product) {
          return res
            .status(404)
            .json({ message: `Product not found: ${item.productId}` });
        }

        const lineTotal = product.price * item.quantity;
        totalPrice += lineTotal;

        newItems.push({
          productId: product._id,
          name: product.name,
          quantity: item.quantity,
          price: product.price,
          total: lineTotal,
        });
      }

      order.items = newItems;
      order.totalPrice = totalPrice; // 🔑 تحديث رسوم التوصيل وإجمالي السعر لو فيه تغيير في العميل/الأصناف
      if (order.type === "DELIVERY" && (customerId || updates.items)) {
        // جلب رسوم التوصيل الجديدة
        const targetCustomerId = customerId || order.customerId;
        let newDeliveryFee = 0;

        if (targetCustomerId) {
          const populatedCustomer = await Customer.findById(
            targetCustomerId
          ).populate("zoneId");
          newDeliveryFee = populatedCustomer?.zoneId?.deliveryFee || 0;
        }
        order.deliveryFee = newDeliveryFee;
      }
    } // ✅ أي تحديثات إضافية

    if (updates.status !== undefined) order.status = updates.status;
    if (updates.paymentStatus !== undefined)
      order.paymentStatus = updates.paymentStatus;
    if (updates.customerId !== undefined) order.customerId = updates.customerId;
    if (updates.deliveryId !== undefined) order.deliveryId = updates.deliveryId;
    if (updates.branchId !== undefined) order.branchId = updates.branchId; // 🛑 إعادة حساب grandTotal بعد أي تعديل

    if (order.type === "DELIVERY") {
      order.grandTotal = order.totalPrice + order.deliveryFee;
    } else {
      order.grandTotal = order.totalPrice;
    }

    await order.save(); // ✅ Populate شامل قبل الإرسال

    const populatedOrder = await Order.findById(order._id)
      .populate({
        path: "customerId",
        populate: { path: "zoneId" },
      })
      .populate("items.productId", "name price")
      .populate("deliveryId", "name phone")
      .populate("branchId", "name")
      .populate("tenantId", "name")
      .populate("createdBy", "name"); // 🟢 إرسال إشعار تعديل الأوردر لجميع الأطراف

    if (global.notifyOrder) {
      global.notifyOrder({
        branchId: branchId?.toString(),
        tenantId: req.user.tenantId?.toString(),
        order: populatedOrder,
        eventType: "UPDATE", // تحديد نوع الحدث: تعديل
      });
    }

    res.json({ message: "تم تعديل الأوردر بنجاح", order: populatedOrder });
  } catch (err) {
    console.error("❌ Error updating order:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =================================================================
// ✅ جلب كل الأوردرات الخاصة بشيفت معين (مهما كانت حالتها)
// =================================================================
router.get("/branch-all-orders", requireAuth, async (req, res) => {
  try {
    const { role, tenantId, branchId: userBranchId } = req.user;

    const { shiftId: selectedShiftId } = req.query; 

    const targetBranchId = userBranchId;

    if (!targetBranchId) {
      return res.status(403).json({ message: "Branch ID not found for the user." });
    }

    let finalShiftId = selectedShiftId;
    console.log(finalShiftId)

    if (finalShiftId === "null") {
      return res.json([]);
    }

    if (finalShiftId === "open" || !finalShiftId) {

      const openShift = await Shift.findOne({
        tenantId,
        branchId: targetBranchId,
        status: "OPEN", // شرط أن يكون الشيفت مفتوحاً حالياً
      }).select('_id');

      if (openShift) {
        finalShiftId = openShift._id; // نستخدم ID الشيفت المفتوح
      } else {
        return res.json([]);
      }
    }

    const filter = {
      tenantId,
      branchId: targetBranchId,
    };

    filter.shiftId = finalShiftId;
    const orders = await Order.find(filter)
      .populate({
        path: "customerId",
        populate: { path: "zoneId" },
      })
      .populate("items.productId")
      .populate("deliveryId")
      .populate("branchId")
      .populate("tenantId")
      .populate("createdBy")
      .populate("zoneId")
      .populate("shiftId")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    console.error("❌ Error fetching all branch orders:", err);
    res.status(500).json({ message: "Server error" });
  }
});
module.exports = router;
