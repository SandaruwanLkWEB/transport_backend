const dotenv = require("dotenv");
dotenv.config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "8080", 10),
  JWT_SECRET: must("JWT_SECRET"),
  DATABASE_URL: must("DATABASE_URL"),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
  REPORT_TITLE: process.env.REPORT_TITLE || "Transport Requests",
  // Brevo (Transactional email) - used for OTP password reset
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || "",
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || "",
  APP_NAME: process.env.APP_NAME || "Transport Request System",
  FRONTEND_URL: process.env.FRONTEND_URL || ""

};

module.exports = { env };
