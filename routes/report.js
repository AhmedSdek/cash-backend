// routes/report.js
const express = require("express");
const router = express.Router();
const Shift = require("../models/Shift");
const Branch = require("../models/Branch");
const requireAuth = require("../middleware/requireAuth");
const Order = require("../models/Order");
const mongoose = require("mongoose");
// 📊 تقرير المبيعات (لكل الفروع أو فرع محدد)
router.get("/", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "ممنوع" });
    }

    const { from, to, branchId } = req.query; // 🗓️ فلترة الفترة (من بداية اليوم لنهاية اليوم)

    const dateFilter = {};
    if (from || to) {
      dateFilter.openedAt = {};
      if (from) {
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0); // بداية اليوم
        dateFilter.openedAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999); // نهاية اليوم
        dateFilter.openedAt.$lte = toDate;
      }
    } // 🟢 لو اختار فرع معين

    let branches;
    if (branchId) {
      branches = await Branch.find({
        tenantId: req.user.tenantId,
        _id: branchId,
      });
    } else {
      branches = await Branch.find({ tenantId: req.user.tenantId });
    }

    let reports = [];
    let finalTotal = {
      delivery: { count: 0, total: 0 },
      cashier: { count: 0, total: 0 },
      overall: { count: 0, total: 0 },
    }; // 🟢 لفة على الفروع

    for (let branch of branches) {
      const shifts = await Shift.find({
        tenantId: req.user.tenantId,
        branchId: branch._id,
        ...dateFilter,
      }).sort({ openedAt: 1 });

      let branchTotals = {
        delivery: { count: 0, total: 0 },
        cashier: { count: 0, total: 0 },
        overall: { count: 0, total: 0 },
      };

      let shiftReports = [];

      for (let shift of shifts) {
        const shiftReport = {
          shiftId: shift._id,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          delivery: {
            count: shift.totals.deliveryOrdersCount,
            total: shift.totals.delivery,
          },
          cashier: {
            count: shift.totals.takeawayOrdersCount,
            total: shift.totals.takeaway,
          },
          overall: {
            count:
              shift.totals.deliveryOrdersCount +
              shift.totals.takeawayOrdersCount,
            total: shift.totals.overall,
          },
        };

        shiftReports.push(shiftReport); // جمع إجمالي الفرع

        branchTotals.delivery.count += shiftReport.delivery.count;
        branchTotals.delivery.total += shiftReport.delivery.total;
        branchTotals.cashier.count += shiftReport.cashier.count;
        branchTotals.cashier.total += shiftReport.cashier.total;
        branchTotals.overall.count += shiftReport.overall.count;
        branchTotals.overall.total += shiftReport.overall.total;
      }

      reports.push({
        branchId: branch._id,
        name: branch.name,
        totals: branchTotals,
        shifts: shiftReports,
      }); // جمع الإجمالي النهائي

      finalTotal.delivery.count += branchTotals.delivery.count;
      finalTotal.delivery.total += branchTotals.delivery.total;
      finalTotal.cashier.count += branchTotals.cashier.count;
      finalTotal.cashier.total += branchTotals.cashier.total;
      finalTotal.overall.count += branchTotals.overall.count;
      finalTotal.overall.total += branchTotals.overall.total;
    }

    res.json({ branches: reports, finalTotal });
  } catch (err) {
    console.error("❌ Error generating report:", err);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء التقرير" });
  }
});

// 📊 تقرير المبيعات بالأصناف
router.get("/products", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "ممنوع" });
    }

    const { from, to, branchId } = req.query; // 🗓️ فلترة التاريخ

    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);
        dateFilter.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = toDate;
      }
    } // 🟢 الفلترة الأساسية

    const matchStage = {
      tenantId: new mongoose.Types.ObjectId(req.user.tenantId),
      type: { $in: ["TAKEAWAY", "DELIVERY"] },
      ...dateFilter,
    };

    if (branchId && branchId !== "all" && branchId.trim() !== "") {
      matchStage.branchId = new mongoose.Types.ObjectId(branchId);
    } // 🧮 pipeline

    const productReport = await Order.aggregate([
      { $match: matchStage },
      { $unwind: "$items" }, // ✅ جلب بيانات المنتج الأصلية من Collection المنتجات

      {
        $lookup: {
          from: "products",
          localField: "items.productId",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },

      {
        $group: {
          _id: "$items.productId",
          name: { $first: "$productInfo.name" },
          price: { $first: "$productInfo.price" }, // ✅ السعر الحقيقي من جدول المنتجات
          totalQuantity: { $sum: "$items.quantity" },
          totalSales: { $sum: "$items.total" },
        },
      },
      { $sort: { totalSales: -1 } },
    ]); // 🟢 الإجماليات

    const grandTotalQuantity = productReport.reduce(
      (sum, p) => sum + p.totalQuantity,
      0
    );
    const grandTotalSales = productReport.reduce(
      (sum, p) => sum + p.totalSales,
      0
    );

    res.json({
      products: productReport,
      totals: {
        totalQuantity: grandTotalQuantity,
        totalSales: grandTotalSales,
      },
    });
  } catch (err) {
    console.error("❌ Error generating product report:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📊 تقرير المستخدمين (حسب الفروع أو يوزر محدد)

router.get("/users", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "ممنوع" });
    }

    const { from, to, branchId, userId } = req.query; // 🗓️ فلترة التاريخ (لو موجود)

    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);
        dateFilter.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = toDate;
      }
    } // 🟢 فلترة الفرع لو موجود

    let branchFilter = {};
    if (branchId && branchId !== "all") {
      branchFilter = { branchId: new mongoose.Types.ObjectId(branchId) };
    } // 🟢 فلترة المستخدم لو موجود

    let userFilter = {};
    if (userId && userId !== "all") {
      userFilter = { createdBy: new mongoose.Types.ObjectId(userId) };
    } // 🧮 pipeline للتجميع

    const userReport = await Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(req.user.tenantId),
          type: { $in: ["TAKEAWAY", "DELIVERY"] },
          ...dateFilter,
          ...branchFilter,
          ...userFilter,
        },
      },
      {
        $group: {
          _id: { user: "$createdBy", type: "$type" }, // جروب باليوزر والنوع
          totalOrders: { $sum: 1 },
          totalSales: { $sum: "$grandTotal" }, // هنا نستخدم grandTotal
        },
      },
      {
        $group: {
          _id: "$_id.user",
          types: {
            $push: {
              type: "$_id.type",
              totalOrders: "$totalOrders",
              totalSales: "$totalSales",
            },
          },
          totalOrders: { $sum: "$totalOrders" },
          totalSales: { $sum: "$totalSales" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          userName: "$user.name",
          userRole: "$user.role",
          totalOrders: 1,
          totalSales: 1,
          types: 1,
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    res.json(userReport);
  } catch (err) {
    console.error("❌ Error generating user report:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
