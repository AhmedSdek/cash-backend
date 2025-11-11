const jwt = require("jsonwebtoken");
const User = require("../models/User");

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1]; // Bearer <token>
    if (!token) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    // ✅ verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ get user from DB
    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    // ✅ attach user to request
    req.user = {
      _id: user._id,
      role: user.role,
      tenantId: user.tenantId,
      branchId: user.branchId,
      name: user.name,
      ...(user.phone && { phone: user.phone }), // في حالة الدليفري
    };

    next();
  } catch (err) {
    console.error("Auth error:", err);

    // ✅ لو التوكن منتهي خلي الرسالة واضحة
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "jwt expired" });
    }

    return res.status(401).json({ message: "Unauthorized" });
  }
};

module.exports = requireAuth;
