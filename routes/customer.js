// routes/customer.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const requireAuth = require("../middleware/requireAuth");

// 🟢 إضافة عميل جديد
// routes/customer.js
// 🟢 إضافة أو تحديث عميل
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, address, phone1, phone2, zoneId } = req.body;

    if (!name || !address || !phone1 || !zoneId) {
      return res
        .status(400)
        .json({ message: "Name, address, phone1, and zoneId are required" });
    }

    let customer = await Customer.findOne({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      phone1: phone1,
    });

    if (customer) {
      customer.name = name;
      customer.address = address;
      customer.phone2 = phone2;
      customer.zoneId = zoneId;
      await customer.save();

      // ✅ رجع العميل بعد ما نعمل populate للـ zoneId
      const populatedCustomer = await Customer.findById(customer._id).populate(
        "zoneId",
        "name deliveryFee"
      );

      return res.status(200).json({
        message: "تم تحديث بيانات العميل",
        customer: populatedCustomer,
      });
    }

    customer = await Customer.create({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
      name,
      address,
      phone1,
      phone2,
      zoneId,
    });

    // ✅ رجع العميل بعد الإنشاء مع بيانات الزون كاملة
    const populatedCustomer = await Customer.findById(customer._id).populate(
      "zoneId",
      "name deliveryFee"
    );

    res
      .status(201)
      .json({ message: "تم إنشاء العميل", customer: populatedCustomer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🟢 جلب العملاء مع بيانات الزون
router.get("/", requireAuth, async (req, res) => {
  try {
    const customers = await Customer.find({
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
    }).populate("zoneId"); // 🔹 رجع بيانات الزون مع العميل
    res.json(customers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🟢 جلب عميل بالهاتف (phone1 أو phone2)
router.get("/search", requireAuth, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // 1. بناء كائن البحث الأساسي
    const query = {
      tenantId: req.user.tenantId,
      $or: [{ phone1: phone }, { phone2: phone }],
    };

    // 2. تطبيق شرط branchId بشكل مشروط (فقط إذا كان المستخدم يملك branchId)
    if (req.user.branchId) {
      // موظف فرع: يجب أن يرى عملاء فرعه فقط
      query.branchId = req.user.branchId;
    }
    // موظف كول سنتر أو مدير عام: لا يملك branchId، لذا سيبحث على مستوى tenantId بالكامل.

    // 3. تنفيذ البحث باستخدام الكائن الديناميكي
    const customer = await Customer.findOne(query).populate("zoneId");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// ✅ تعديل بيانات العميل
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone1, phone2, zoneId } = req.body;

    // نتأكد إن العميل موجود
    let customer = await Customer.findOne({
      _id: id,
      tenantId: req.user.tenantId,
      branchId: req.user.branchId,
    });

    if (!customer) {
      return res.status(404).json({ message: "العميل غير موجود" });
    }

    // تحديث البيانات
    customer.name = name || customer.name;
    customer.address = address || customer.address;
    customer.phone1 = phone1 || customer.phone1;
    customer.phone2 = phone2 || customer.phone2;
    customer.zoneId = zoneId || customer.zoneId;

    await customer.save();

    // ✅ نعمل populate علشان يرجع بيانات الزون
    customer = await Customer.findById(customer._id).populate("zoneId");

    res.json({
      message: "تم تحديث بيانات العميل بنجاح",
      customer,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

module.exports = router;
