const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: false,
    },
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone1: { type: String, required: true },
    phone2: { type: String },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone", // 🔹 ربط العميل بالزون
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Customer", customerSchema);
