const requireAuth = require("../middleware/requireAuth");
const Message = require("../models/Message");

// Server: routes/chat.js (مثال لنقطة نهاية)
router.get("/:recipientId", requireAuth, async (req, res) => {
  const senderId = req.user._id; // المستخدم الحالي
  const recipientId = req.params.recipientId;
  const tenantId = req.user.tenantId; // يجب أن يكون مخزناً في التوكن

  try {
    const messages = await Message.find({
      tenantId: tenantId,
      $or: [
        { sender: senderId, recipient: recipientId },
        { sender: recipientId, recipient: senderId },
      ],
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching chat history" });
  }
});
