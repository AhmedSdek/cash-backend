const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // إيميلك
    pass: process.env.EMAIL_PASS, // App Password لو Gmail
  },
});

async function sendMail(to, subject, text) {
  try {
    const info = await transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });

    console.log("✅ Email sent:", info.messageId);
  } catch (error) {
    console.error("❌ Error sending email:", error);
    throw error;
  }
}

module.exports = sendMail;
