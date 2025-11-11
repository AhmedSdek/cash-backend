// في ملف ./app.js

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

// 💡 موديل الرسائل (يجب نقله إلى ملف models/Message.js في بيئة العمل الحقيقية)
const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
  },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const Message =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);
// ----------------------------------------------------

// Routers
const authRouter = require("./routes/auth");
const productRouter = require("./routes/products");
const orderRouter = require("./routes/orders");
const deliveryRouter = require("./routes/delivery");
const shiftRoutes = require("./routes/shift");
const reportRoutes = require("./routes/report");
const tenantRoutes = require("./routes/tenant");
const customerRoutes = require("./routes/customer");
const userRoutes = require("./routes/user");
const zoneRoutes = require("./routes/zoneRoutes");
const callCenterRoutes = require("./routes/callCenter");
const requireAuth = require("./middleware/requireAuth");

const app = express();
const server = http.createServer(app);

// ========================
// ✅ إعداد Socket.io
// ========================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// ========================
// 🔹 تخزين المستخدمين النشطين (Socket ID -> User Data)
// ========================
const onlineUsers = new Map();

// ✅ دالة مساعدة لإرسال قائمة الأونلاين المحدثة للتينانت
const notifyOnlineUsers = (tenantId) => {
  const tenantUsers = [];
  if (!tenantId) return;

  for (const user of onlineUsers.values()) {
    if (
      user &&
      user.tenantId &&
      user.tenantId.toString() === tenantId.toString()
    ) {
      tenantUsers.push({
        userId: user.userId,
        name: user.name,
        role: user.role,
        branchId: user.branchId,
      });
    }
  }

  io.to(`tenant_${tenantId}`).emit("onlineUsersUpdate", tenantUsers);
  console.log(
    `📢 Sent onlineUsersUpdate to Tenant ${tenantId}: ${tenantUsers.length} users online.`
  );
};

// ========================
// 🔹 حدث الاتصال
// ========================
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("registerUser", ({ userId, branchId, tenantId, name, role }) => {
    if (userId && tenantId) {
      onlineUsers.set(socket.id, {
        userId,
        branchId,
        tenantId,
        name,
        role,
        socketId: socket.id,
      });

      socket.join(`tenant_${tenantId}`);

      if (branchId) {
        socket.join(`branch_${branchId}`);
      }

      console.log(
        `👤 User ${name} (${userId}) registered and joined tenant ${tenantId} (branch: ${branchId})`
      );

      notifyOnlineUsers(tenantId);
    }
  });

  socket.on("joinBranch", (branchId) => {
    if (branchId) {
      socket.join(`branch_${branchId}`);
      console.log(`🏠 Branch ${branchId} joined room by ${socket.id}`);
    }
  });

  socket.on("joinTenant", (tenantId) => {
    if (tenantId) {
      socket.join(`tenant_${tenantId}`);
      console.log(`🏢 Tenant ${tenantId} joined room by ${socket.id}`);
    }
  });

  socket.on(
    "privateMessage",
    async ({ recipientId, message, senderId, senderName, tenantId }) => {
      // جعل الدالة async
      if (!tenantId) {
        console.error("❌ privateMessage received without tenantId.");
        io.to(socket.id).emit("chatError", {
          message: `لا يمكن إرسال الرسالة: خطأ في تحديد المطعم (Tenant ID مفقود).`,
        });
        return;
      } // 💡 1. حفظ الرسالة في قاعدة البيانات
      let savedMessage;
      try {
        savedMessage = new Message({
          sender: senderId,
          recipient: recipientId,
          tenantId: tenantId,
          message: message,
        });
        await savedMessage.save();
        console.log(`💾 Message saved to DB: ${savedMessage._id}`);
      } catch (error) {
        console.error("❌ Error saving message to DB:", error);
        io.to(socket.id).emit("chatError", {
          message: `فشل إرسال الرسالة (خطأ في قاعدة البيانات).`,
        });
        return;
      } // البحث عن الـ Socket ID الخاص بالمستقبل
      let recipientSocketId = null;

      for (const [socketId, user] of onlineUsers.entries()) {
        if (
          user &&
          user.userId &&
          user.tenantId &&
          user.userId.toString() === recipientId.toString() &&
          tenantId &&
          user.tenantId.toString() === tenantId.toString()
        ) {
          recipientSocketId = socketId;
          break;
        }
      } // 💡 2. تحديث حمولة الرسالة بالبيانات من قاعدة البيانات
      const messagePayload = {
        _id: savedMessage._id, // إضافة الـ ID الجديد
        senderId,
        senderName,
        message,
        timestamp: savedMessage.timestamp,
      };

      if (recipientSocketId) {
        // إرسال للمستقبل
        io.to(recipientSocketId).emit("receiveMessage", messagePayload); // إرسال نسخة للمرسل

        io.to(socket.id).emit("receiveMessage", {
          ...messagePayload,
          recipientId,
          isSelf: true,
        });

        console.log(
          `✉️ Message sent from ${senderName} to ${recipientId} in Tenant ${tenantId}`
        );
      } else {
        // الرسالة محفوظة، لكن المستقبل غير متصل، نرسل تأكيد للمرسل فقط
        io.to(socket.id).emit("receiveMessage", {
          ...messagePayload,
          recipientId,
          isSelf: true,
          status: "sent_offline", // حالة اختيارية للإشارة إلى أن المستقبل غير متصل
        });
        console.log(
          `⚠️ Recipient ${recipientId} is offline. Message saved and sent to sender.`
        );
      }
    }
  );

  socket.on("leaveBranch", (branchId) => {
    socket.leave(`branch_${branchId}`);
    console.log(`🚪 Branch ${branchId} left room by ${socket.id}`);
  });

  socket.on("leaveTenant", (tenantId) => {
    socket.leave(`tenant_${tenantId}`);
    console.log(`🚪 Tenant ${tenantId} left room by ${socket.id}`);
  });

  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    if (user && user.tenantId) {
      onlineUsers.delete(socket.id);
      console.log(`❌ User ${user.name} disconnected.`);
      notifyOnlineUsers(user.tenantId);
    }
    console.log("❌ User disconnected:", socket.id);
  });
});

// ========================
// 🔹 دالة عامة لإرسال الأوردرات (محتفظ بها كما هي)
// ========================
// global.notifyOrder = (orderData) => {
//   const { branchId, tenantId, order } = orderData;

//   if (tenantId) {
//     io.to(`tenant_${tenantId}`).emit("updateOrder", orderData);
//     console.log(`📤 Sent updateOrder to Tenant (Call Center): ${tenantId}`);
//   }

//   if (branchId) {
//     const branchSockets =
//       io.sockets.adapter.rooms.get(`branch_${branchId}`) || new Set();
//     const tenantSockets =
//       io.sockets.adapter.rooms.get(`tenant_${tenantId}`) || new Set();

//     const targetSockets = new Set();
//     branchSockets.forEach((socketId) => targetSockets.add(socketId));
//     tenantSockets.forEach((socketId) => targetSockets.add(socketId));

//     targetSockets.forEach((socketId) => {
//       io.to(socketId).emit("updateOrder", orderData);
//     });

//     console.log(`📤 Sent updateOrder to ${targetSockets.size} unique sockets.`);
//   }

//   if (order?.deliveryId) {
//     io.to(`delivery_${order.deliveryId}`).emit("updateOrder", orderData);
//     console.log(`📤 Sent updateOrder to delivery: ${order.deliveryId}`);
//   }

//   console.log("📦 Order event broadcasted:", orderData.order?._id);
// };

global.notifyOrder = (orderData) => {
  const { branchId, tenantId, order, eventType } = orderData; // 💡 تم إضافة eventType // 🔑 تحديد اسم الحدث حسب eventType

  const eventName = eventType === "NEW" ? "newOrder" : "orderUpdated";

  if (tenantId) {
    io.to(`tenant_${tenantId}`).emit(eventName, orderData);
    console.log(`📤 Sent ${eventName} to Tenant (Call Center): ${tenantId}`);
  }

  if (branchId) {
    const branchSockets =
      io.sockets.adapter.rooms.get(`branch_${branchId}`) || new Set();
    const tenantSockets =
      io.sockets.adapter.rooms.get(`tenant_${tenantId}`) || new Set();

    const targetSockets = new Set();
    branchSockets.forEach((socketId) => targetSockets.add(socketId));
    tenantSockets.forEach((socketId) => targetSockets.add(socketId));

    targetSockets.forEach((socketId) => {
      io.to(socketId).emit(eventName, orderData); // 💡 استخدام eventName
    });

    console.log(
      `📤 Sent ${eventName} to ${targetSockets.size} unique sockets.`
    );
  }

  if (order?.deliveryId) {
    io.to(`delivery_${order.deliveryId}`).emit(eventName, orderData); // 💡 استخدام eventName
    console.log(`📤 Sent ${eventName} to delivery: ${order.deliveryId}`);
  }

  console.log(
    `📦 Order event broadcasted: ${eventName} - ${orderData.order?._id}`
  );
};

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// ========================
// Routes
// ========================
// 💡 إنشاء مسار router خاص بالشات (Chat Router)
const chatRouter = express.Router();

// ----------------------------------------------------
// 💡 المسار الجديد لجلب سجل الشات (Chat History API)
// 💡 تم نقله إلى router.get("/history/:recipientId", ...)
// ----------------------------------------------------
chatRouter.get("/history/:recipientId", requireAuth, async (req, res) => {
  try {
    if (!req.user || !req.user.tenantId) {
      return res
        .status(401)
        .json({ message: "Authentication required or Tenant ID missing." });
    }

    const senderId = req.user._id;
    const recipientId = req.params.recipientId;
    const tenantId = req.user.tenantId; // جلب الرسائل بين المرسل والمستقبل في نطاق التينانت

    const messages = await Message.find({
      tenantId: tenantId,
      $or: [
        { sender: senderId, recipient: recipientId },
        { sender: recipientId, recipient: senderId },
      ],
    })
      .select("sender recipient message timestamp") // نحدد الحقول المطلوبة فقط
      .sort({ timestamp: 1 }); // ترتيب زمني صاعد // تحويل الرسائل للواجهة الأمامية

    const formattedMessages = messages.map((msg) => ({
      _id: msg._id,
      senderId: msg.sender,
      recipientId: msg.recipient,
      message: msg.message,
      timestamp: msg.timestamp,
      isSelf: msg.sender.toString() === senderId.toString(),
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res
      .status(500)
      .json({ message: "Error fetching chat history", error: error.message });
  }
});

// ✅ إضافة مسار الشات مع باقي مسارات الـ API
app.use("/api/auth", authRouter);
app.use("/api/products", productRouter);
app.use("/api/orders", orderRouter);
app.use("/api/deliveries", deliveryRouter);
app.use("/api/shifts", shiftRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/callcenter", callCenterRoutes);
// 🔑 الدمج هنا يضمن وصول الطلب لـ /api/chat/history/:recipientId
app.use("/api/chat", chatRouter);

// ========================
// ✅ نقطة اختبار
// ========================
app.get("/", (req, res) => {
  res.json({ message: "POS API running..." });
});

// ========================
// Port & MongoDB
// ========================
const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB connection error:", err);
  });
