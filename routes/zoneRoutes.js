const express = require("express");
const Zone = require("../models/Zone");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ✅ إنشاء منطقة جديدة برسوم التوصيل
router.post("/", requireAuth, async (req, res) => {
  try {
    const { branchId, name, deliveryFee } = req.body;

    if (!branchId || !name || deliveryFee == null) {
      return res.status(400).json({ message: "كل الحقول مطلوبة" });
    }

    const newZone = new Zone({
      tenantId: req.user.tenantId,
      branchId,
      name,
      deliveryFee,
    });

    await newZone.save();

    res.status(201).json({
      message: "تم إنشاء المنطقة بنجاح",
      zone: newZone,
    });
  } catch (error) {
    console.error("Error creating zone:", error);
    res.status(500).json({ message: "حدث خطأ ما" });
  }
});

// ✅ جلب كل المناطق (حسب الفرع أو التينانت لو محتاج)
router.get("/", requireAuth, async (req, res) => {
  try {
    const { tenantId, branchId } = req.query;
    let query = {};
    if (tenantId) query.tenantId = tenantId;
    if (branchId && branchId !== "all") query.branchId = branchId; // 🟢 تجاهل "all"
    const zones = await Zone.find(query).populate("branchId", "name");
    res.status(200).json(zones);
  } catch (error) {
    console.error("Error fetching zones:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المناطق" });
  }
});

// ✅ تعديل منطقة
router.put("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "غير مسموح لك بالتعديل" });
    }

    const { id } = req.params;
    const { name, deliveryFee, branchId } = req.body;

    const updatedZone = await Zone.findByIdAndUpdate(
      id,
      { name, deliveryFee, branchId },
      { new: true }
    );

    if (!updatedZone) {
      return res.status(404).json({ message: "المنطقة غير موجودة" });
    }

    res
      .status(200)
      .json({ message: "تم تعديل المنطقة بنجاح", zone: updatedZone });
  } catch (error) {
    console.error("Error updating zone:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تعديل المنطقة" });
  }
});

// ✅ حذف منطقة
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "غير مسموح لك بالحذف" });
    }

    const { id } = req.params;
    const deletedZone = await Zone.findByIdAndDelete(id);

    if (!deletedZone) {
      return res.status(404).json({ message: "المنطقة غير موجودة" });
    }

    res.status(200).json({ message: "تم حذف المنطقة بنجاح" });
  } catch (error) {
    console.error("Error deleting zone:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حذف المنطقة" });
  }
});
module.exports = router;
