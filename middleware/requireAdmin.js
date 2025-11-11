function requireAdmin(req, res, next) {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Access denied. Admins only." });
  }
  next();
}

module.exports = requireAdmin;
