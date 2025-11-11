// routes/callCenter.js
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Customer = require("../models/Customer");
const Zone = require("../models/Zone");
const Shift = require("../models/Shift");
const Counter = require("../models/Counter"); // 💡 تم إضافة استدعاء موديل Counter
const requireAuth = require("../middleware/requireAuth");
const User = require("../models/User");

// 🟢 إضافة عميل جديد (من الكول سنتر أو أي موظف مصرح له)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, address, phone1, phone2, zoneId, branchId } = req.body;
    const { tenantId, role } = req.user; // ✅ السماح فقط لأدوار معينة (كول سنتر/أونر/أدمن)

    if (
      !["OWNER", "ADMIN", "CALL_CENTER_ADMIN", "CALL_CENTER_USER"].includes(
        role
      )
    ) {
      return res.status(403).json({ message: "غير مسموح لك بإضافة عميل" });
    } // ✅ التحقق من البيانات الأساسية

    if (!name || !address || !phone1 || !zoneId || !branchId) {
      return res
        .status(400)
        .json({ message: "الاسم والعنوان والتليفون والمنطقة والفرع مطلوبين" });
    } // ✅ التحقق لو العميل بنفس الرقم موجود بالفعل في نفس الفرع

    const existingCustomer = await Customer.findOne({
      tenantId,
      branchId,
      phone1,
    });
    if (existingCustomer) {
      return res
        .status(400)
        .json({ message: "هذا العميل مسجل بالفعل بنفس رقم الهاتف" });
    } // ✅ إنشاء العميل

    const newCustomer = new Customer({
      tenantId,
      branchId,
      name,
      address,
      phone1,
      phone2,
      zoneId,
    });

    await newCustomer.save();

    res.status(201).json({
      message: "تم إضافة العميل بنجاح",
      customer: newCustomer,
    });
  } catch (err) {
    console.error("Error creating customer:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// ✅ إضافة أوردر من الكول سنتر
router.post("/orders", requireAuth, async (req, res) => {
  try {
    const { branchId, customerId, type, items, zoneId } = req.body; // 1. تأكد من الزون

    const zone = await Zone.findById(zoneId);
    if (!zone) return res.status(400).json({ message: "Zone not found" }); // 2. تأكد من وجود شيفت مفتوح للفرع

    const shift = await Shift.findOne({ branchId, status: "OPEN" });
    if (!shift)
      return res.status(400).json({ message: "No open shift for this branch" }); // 3. هات العميل

    const customer = await Customer.findById(customerId);
    if (!customer)
      return res.status(400).json({ message: "Customer not found" }); // 4. لوجيك العداد: هات وزوّد orderNumber للشيفت الحالي

    // 💡 التعديل هنا لضمان التسلسل الصحيح لكل شيفت
    const counter = await Counter.findOneAndUpdate(
      {
        tenantId: req.user.tenantId,
        branchId,
        shiftId: shift._id,
        name: "orderNumber",
      },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const orderNumber = counter.seq; // 5. حساب الأسعار

    let totalPrice = items.reduce((sum, item) => sum + item.total, 0);
    // 💡 يجب أن تكون رسوم التوصيل 0 لو Type ليس DELIVERY
    let deliveryFee = type === "DELIVERY" ? zone.deliveryFee : 0;
    let grandTotal = totalPrice + deliveryFee; // 6. إنشاء الأوردر

    const order = new Order({
      tenantId: req.user.tenantId,
      branchId,
      shiftId: shift._id, // 🛑 التعديل هنا: cashierId يكون null لأنه سيتم تعيينه لاحقاً للدليفري أو كاشير التحصيل
      cashierId: null,
      createdBy: req.user._id,
      source: "CALL_CENTER",
      type,
      items,
      totalPrice,
      deliveryFee: deliveryFee, // استخدام deliveryFee المحسوبة
      grandTotal: grandTotal, // استخدام grandTotal المحسوبة
      customerId,
      zoneId,
      orderNumber: orderNumber, // 💡 استخدام رقم الأوردر المتسلسل
      // حالة الأوردر والدفع: افتراضياً NEW و UNPAID للكول سنتر
      status: "NEW",
      paymentStatus: "UNPAID",
    });

    await order.save();

    res.status(201).json({ message: "Order created successfully", order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// 🟢 البحث عن عميل بالهاتف
router.get("/search", requireAuth, async (req, res) => {
  try {
    const { phone } = req.query;
    const { tenantId, role } = req.user;

    if (
      !["OWNER", "ADMIN", "CALL_CENTER_ADMIN", "CALL_CENTER_USER"].includes(
        role
      )
    ) {
      return res.status(403).json({ message: "غير مسموح بالبحث عن العملاء" });
    }

    if (!phone) {
      return res.status(400).json({ message: "من فضلك أدخل رقم الهاتف للبحث" });
    } // ✅ البحث عن العميل برقم phone1 أو phone2 في نفس التينانت

    const customer = await Customer.findOne({
      tenantId,
      $or: [{ phone1: phone }, { phone2: phone }],
    }).populate("zoneId branchId"); // عشان يجيب بيانات الفرع والمنطقة كمان

    if (!customer) {
      return res.status(404).json({ message: "🚫 العميل غير موجود" });
    }

    console.log({ customer });
    res.json({ customer });
  } catch (err) {
    console.error("Error searching customer:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// 🟢 تعديل بيانات عميل
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone1, phone2, zoneId, branchId } = req.body;
    const { tenantId, role } = req.user; // ✅ السماح فقط لأدوار معينة

    if (
      !["OWNER", "ADMIN", "CALL_CENTER_ADMIN", "CALL_CENTER_USER"].includes(
        role
      )
    ) {
      return res
        .status(403)
        .json({ message: "غير مسموح لك بتعديل بيانات العميل" });
    } // ✅ هات العميل الأول

    let customer = await Customer.findOne({ _id: id, tenantId });
    if (!customer) {
      return res.status(404).json({ message: "🚫 العميل غير موجود" });
    } // ✅ تحديث البيانات

    customer.name = name || customer.name;
    customer.address = address || customer.address;
    customer.phone1 = phone1 || customer.phone1;
    customer.phone2 = phone2 || customer.phone2;
    customer.zoneId = zoneId || customer.zoneId;
    customer.branchId = branchId || customer.branchId;

    await customer.save(); // ✅ رجّع البيانات بعد التعديل + populated للفرع والزون

    customer = await Customer.findById(id).populate("zoneId branchId");

    res.json({
      message: "✅ تم تحديث بيانات العميل بنجاح",
      customer,
    });
  } catch (err) {
    console.error("Error updating customer:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// GET /api/orders/stats/call-center
router.get("/stats/call-center", requireAuth, async (req, res) => {
  try {
    const { role, tenantId } = req.user; // لازم يكون كول سنتر أدمن فقط

    if (role !== "CALL_CENTER_ADMIN") {
      return res.status(403).json({ message: "غير مسموح" });
    }

    const users = await User.find({
      tenantId,
      role: "CALL_CENTER_USER",
    }).select("_id name email"); // حساب الطلبات

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(
      today.setDate(today.getDate() - today.getDay())
    );
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const stats = await Promise.all(
      users.map(async (u) => {
        const daily = await Order.countDocuments({
          createdBy: u._id,
          createdAt: { $gte: startOfDay },
        });

        const weekly = await Order.countDocuments({
          createdBy: u._id,
          createdAt: { $gte: startOfWeek },
        });

        const monthly = await Order.countDocuments({
          createdBy: u._id,
          createdAt: { $gte: startOfMonth },
        });

        return {
          userId: u._id,
          name: u.name,
          email: u.email,
          daily,
          weekly,
          monthly,
        };
      })
    );

    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
