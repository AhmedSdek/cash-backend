// routes/productRoutes.js
const express = require("express");
const Product = require("../models/Product");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const requireOwner = require("../middleware/requireOwner");

const router = express.Router();

// ✅ إضافة صنف جديد (Admin في فرعه / Owner لأي فرع)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, category, price, branchId } = req.body;

    let targetBranchId;
    if (req.user.role === "OWNER") {
      if (!branchId) {
        return res
          .status(400)
          .json({ message: "branchId is required for OWNER" });
      }
      targetBranchId = branchId;
    } else {
      // Admin → يضيف في فرعه فقط
      requireAdmin(req, res, () => { });
      targetBranchId = req.user.branchId;
    }

    const product = await Product.create({
      tenantId: req.user.tenantId,
      branchId: targetBranchId,
      name,
      category,
      price,
    });

    res.status(201).json({ message: "Product created successfully", product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ تعديل صنف (Admin في فرعه / Owner لأي فرع)
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { name, category, price, isActive, branchId } = req.body;

    let filter = { _id: req.params.id, tenantId: req.user.tenantId };

    if (req.user.role === "OWNER") {
      if (branchId) filter.branchId = branchId;
    } else {
      requireAdmin(req, res, () => { });
      filter.branchId = req.user.branchId;
    }

    const product = await Product.findOneAndUpdate(
      filter,
      { name, category, price, isActive },
      { new: true }
    );

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product updated", product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ حذف صنف (Admin في فرعه / Owner لأي فرع)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    let filter = { _id: req.params.id, tenantId: req.user.tenantId };

    if (req.user.role === "OWNER") {
      if (req.body.branchId) filter.branchId = req.body.branchId;
    } else {
      requireAdmin(req, res, () => { });
      filter.branchId = req.user.branchId;
    }

    const product = await Product.findOneAndDelete(filter);

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ عرض الأصناف (Admin في فرعه / Owner لأي فرع)
router.get("/", requireAuth, async (req, res) => {
  try {
    let filter = { tenantId: req.user.tenantId };
    const branchId = req.query.branchId; // GET param

    if (req.user.role === "OWNER") {
      if (branchId) {
        filter.branchId = branchId;
      }
    } else {
      filter.branchId = branchId || req.user.branchId;

      // تأكد من وجود فرع مقيد به هذا المستخدم
      if (!filter.branchId) {
        return res.status(403).json({ message: "Access denied. Branch is required for this role." });
      }
    }

    const products = await Product.find(filter).populate("branchId");

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
