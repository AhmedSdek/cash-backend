const mongoose = require("mongoose");

const cashSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
  totals: {
    takeaway: { type: Number, default: 0 },
    takeawayOrdersCount: { type: Number, default: 0 },
    delivery: { type: Number, default: 0 },
    deliveryOrdersCount: { type: Number, default: 0 },
    overall: { type: Number, default: 0 },
  },
  status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
});

const shiftSchema = new mongoose.Schema({
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

  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },

  openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  // إجمالي الشيفت كله (مجموع كل الكاشات)
  totals: {
    takeaway: { type: Number, default: 0 },
    takeawayOrdersCount: { type: Number, default: 0 },
    delivery: { type: Number, default: 0 },
    deliveryOrdersCount: { type: Number, default: 0 },
    overall: { type: Number, default: 0 },
  },

  // الخزن المرتبطة بالشيفت
  cashes: [cashSchema],

  status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
});

module.exports = mongoose.model("Shift", shiftSchema);
