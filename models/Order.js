// models/Order.js
const mongoose = require("mongoose");

// 💡 حالات سير العمل للأوردر
const orderStatusEnum = [
  "NEW",
  "PREPARING",
  "READY",
  "DELIVERING",
  "DELIVERED",
  "PAID", // يمكن أن نعتبرها حالة نهائية (Complete)
  "CANCELED",
];

// 💡 حالات تتبع الدفع والتحصيل
const paymentStatusEnum = ["UNPAID", "PAID", "REFUNDED"];

const orderSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    cashierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    type: { type: String, enum: ["TAKEAWAY", "DELIVERY"], required: true },

    status: {
      type: String,
      enum: orderStatusEnum,
      default: "NEW",
    },
    paymentStatus: {
      type: String,
      enum: paymentStatusEnum,
      default: "UNPAID",
    },
    deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: "Zone" },

    deliveryFee: { type: Number, default: 0 },

    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        total: { type: Number, required: true },
      },
    ],

    totalPrice: { type: Number, required: true }, // السعر بدون التوصيل // 🔑 تعديل: جعل GrandTotal مطلوب (required)
    grandTotal: { type: Number, required: true }, // السعر النهائي (totalPrice + deliveryFee)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    source: {
      type: String,
      enum: ["CASHIER", "CALL_CENTER"],
      default: "CASHIER",
    },
    orderNumber: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    assignedAt: { type: Date },
    collectedAt: { type: Date },
    paymentMethod: { type: String, enum: ["CASH", "CARD"], default: "CASH" },
  },
  { timestamps: true }
);

// 🔹 قبل الحفظ: المنطق الوحيد المتبقي هو حساب الـ grandTotal
orderSchema.pre("save", function (next) {
  if (this.type === "DELIVERY") {
    this.grandTotal = this.totalPrice + (this.deliveryFee || 0);
  } else {
    this.grandTotal = this.totalPrice;
  } // 🛑 تمت إزالة جميع عمليات التحديث التلقائية للحالة (status/paymentStatus) // هذا يضمن أن الـ Routes هي المسؤولة عن تحديد ما إذا كان الأوردر مدفوعاً أم لا.
  next();
});

module.exports = mongoose.model("Order", orderSchema);
