// models/Counter.js
const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  tenantId: {
    // 🔑 إضافة Tenant ID (للتنظيم في نظام تعدد الإيجار)
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true,
  },
  // 🔑 إضافة اسم العداد (نثبته هنا ليكون 'orderNumber')
  name: {
    type: String,
    required: true,
    default: "orderNumber",
  },
  shiftId: {
    // 🔑 ربط العداد بالشيفت لتسلسله من 1 لكل شيفت
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shift",
    required: true,
  },
  seq: { type: Number, default: 0 },
});

// 🔹 الفهرس الفريد: يضمن وجود عداد واحد لكل نوع (name) في كل شيفت (shiftId) داخل كل فرع (branchId).
// هذا هو المفتاح لإعادة تعيين العداد مع كل شيفت جديد.
counterSchema.index(
  { tenantId: 1, branchId: 1, shiftId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model("Counter", counterSchema);
