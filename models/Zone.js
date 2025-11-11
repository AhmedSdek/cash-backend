// models/Zone.js
const mongoose = require("mongoose");

const zoneSchema = new mongoose.Schema(
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
    name: { type: String, required: true }, // اسم المنطقة
    deliveryFee: { type: Number, required: true }, // رسوم التوصيل
  },
  { timestamps: true }
);

module.exports = mongoose.model("Zone", zoneSchema);
