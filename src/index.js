const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { env } = require("./config/env");
const { errorHandler } = require("./middleware/error");
const sanitizeModule = require("./middleware/sanitize");
const sanitizeRequest =
  typeof sanitizeModule === "function"
    ? sanitizeModule
    : sanitizeModule && typeof sanitizeModule.sanitizeRequest === "function"
      ? sanitizeModule.sanitizeRequest
      : null;

const initSchemaModule = require("./db/initSchema");
const initSchema =
  typeof initSchemaModule === "function"
    ? initSchemaModule
    : initSchemaModule && typeof initSchemaModule.initSchema === "function"
      ? initSchemaModule.initSchema
      : null;

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const hodRoutes = require("./routes/hod");
const adminRoutes = require("./routes/admin");
const taRoutes = require("./routes/ta");
const hrRoutes = require("./routes/hr");
const empRoutes = require("./routes/emp");
const reportsRoutes = require("./routes/reports");
const publicRoutes = require("./routes/public");
const lookupRoutes = require("./routes/lookup");

const app = express();

app.set("trust proxy", 1);

app.use(pinoHttp());

// SECURITY FIX: Enhanced Helmet configuration with comprehensive security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Required for inline styles
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hidePoweredBy: true,
  frameguard: { action: 'deny' }
}));

app.use(express.json({ limit: "1mb" }));
if (typeof sanitizeRequest === "function") {
  app.use(sanitizeRequest);
}


// CORS allowlist
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // curl/postman
      if (env.ALLOWED_ORIGINS.length === 0) return cb(null, true);
      if (env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

// SECURITY FIX: Reduced global rate limit from 600 to 300 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Reduced from 600
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY FIX: Strict rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 attempts per 15 minutes
  message: "Too many authentication attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

// SECURITY FIX: Moderate rate limiting for password reset (prevent abuse)
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 reset attempts
  message: "Too many password reset attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "transport-request-api" })
);

// Apply stricter rate limiting to auth endpoints
app.use("/auth/login", authLimiter);
app.use("/auth/register", authLimiter);
app.use("/auth/register-hod", authLimiter);
app.use("/auth/password-reset", passwordResetLimiter);

app.use("/auth", authRoutes);
app.use("/public", publicRoutes);
app.use("/lookup", lookupRoutes);
app.use("/me", meRoutes);
app.use("/hod", hodRoutes);
app.use("/admin", adminRoutes);
app.use("/ta", taRoutes);
app.use("/hr", hrRoutes);
app.use("/emp", empRoutes);
app.use("/reports", reportsRoutes);

app.use(errorHandler);

(async () => {
  try {
    if (initSchema) {
      await initSchema();
    } else {
      console.warn(
        "[WARN] initSchema export not found. Server will start without auto-migration."
      );
    }

    app.listen(env.PORT, () => {
      console.log(`API running on port ${env.PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
      console.log(`Security: Enhanced headers and rate limiting enabled`);
    });
  } catch (err) {
    console.error("[FATAL] initSchema failed:", err);
    process.exit(1);
  }
})();
