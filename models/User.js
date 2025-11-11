const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },

    name: { type: String, required: true },

    // ✅ أرقام تليفون للدليفري أو الكول سنتر
    phone: { type: String },

    // ✅ إيميل وباسورد لكل المستخدمين غير الدليفري (اختياري له)
    email: { type: String, unique: true, sparse: true },
    passwordHash: { type: String },

    role: {
      type: String,
      enum: [
        "DEVELOPER", // المبرمج - صلاحيات مطلقة
        "OWNER", // صاحب المطعم
        "ADMIN", // إدمن فرع
        "CASHIER", // كاشير
        "DELIVERY", // دليفري
        "CALL_CENTER_ADMIN", // إدمن الكول سنتر
        "CALL_CENTER_USER", // موظف الكول سنتر
      ],
      default: "CASHIER",
    },

    status: {
      type: String,
      enum: ["AVAILABLE", "OUT", "BUSY"],
      default: "AVAILABLE",
    },
    isActive: { type: Boolean, default: true },

    // 🕒 وقت بداية انشغال الدليفري (يتم ضبطه أول ما يدخل BUSY)
    busySince: { type: Date },

    // 🔑 حقول خاصة بإعادة تعيين الباسورد
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
