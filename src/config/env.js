const dotenv = require("dotenv");
dotenv.config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// SECURITY FIX: Validate JWT_SECRET strength
function validateJwtSecret() {
  const secret = must("JWT_SECRET");
  
  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters long for security. ` +
      `Current length: ${secret.length}. ` +
      `Generate a strong secret with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  
  // Warn if secret looks weak (all same character, sequential, etc.)
  if (/^(.)\1+$/.test(secret)) {
    throw new Error("JWT_SECRET appears to be all the same character. Use a random secret.");
  }
  
  if (secret === "your-secret-key-here" || secret === "change-me" || secret === "secret") {
    throw new Error("JWT_SECRET must not use default/example values. Generate a random secret.");
  }
  
  return secret;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "8080", 10),
  JWT_SECRET: validateJwtSecret(), // SECURITY FIX: Validate secret strength
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
