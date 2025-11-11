// createOwner.js
require("./index"); // أو أي مسار لملف الاتصال بـ MongoDB
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const ownerPassword = process.env.OWNER_PASSWORD;
async function createOwner() {
  const passwordHash = await bcrypt.hash(ownerPassword, 10);

  const owner = await User.create({
    name: "Ahmed Sdek",
    email: "asdek229@gmail.com",
    passwordHash: passwordHash,
    role: "DEVELOPER",
    tenantId: null,
    branchId: null,
  });

  console.log("Owner account created:", owner);
  process.exit();
}

createOwner();
