// middleware/auth.js
function requireOwner(req, res, next) {
  // نفترض إنك عندك user object محمّل في req بعد عملية التوثيق
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  if (req.user.role !== "DEVELOPER") {
    return res.status(403).json({ message: "Access denied. Owner only" });
  }

  // لو المستخدم DEVELOPER نسمح بالمرور
  next();
}

module.exports = { requireOwner };
