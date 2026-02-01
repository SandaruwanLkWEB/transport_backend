const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { env } = require("./config/env");
const { errorHandler } = require("./middleware/error");
const { initSchema } = require("./db/initSchema");

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

// Trust Railway proxy (required for rate limiting + correct IP)
app.set("trust proxy", 1);


app.use(pinoHttp());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// CORS allowlist (supports exact origins, hostnames, and wildcards like *.example.com)
function normalizeOrigin(o) {
  return String(o || "").trim().replace(/\/$/, "");
}
function getHost(origin) {
  try { return new URL(origin).host.toLowerCase(); } catch { return ""; }
}
function isAllowed(origin) {
  if (!origin) return true; // curl/postman
  const o = normalizeOrigin(origin);
  if (env.ALLOWED_ORIGINS.length === 0) return true;

  const host = getHost(o);
  for (const raw of env.ALLOWED_ORIGINS) {
    const a = normalizeOrigin(raw);
    if (!a) continue;
    // exact origin match
    if (a.startsWith("http://") || a.startsWith("https://")) {
      if (normalizeOrigin(a) === o) return true;
      continue;
    }
    // wildcard hostname match (*.example.com)
    if (a.startsWith("*.")) {
      const suffix = a.slice(2).toLowerCase();
      if (host === suffix || host.endsWith("." + suffix)) return true;
      continue;
    }
    // plain hostname match
    if (host === a.toLowerCase()) return true;
  }
  return false;
}

app.use(cors({
  origin: function(origin, cb) {
    if (isAllowed(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"), false);
  },
  credentials: true
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600
}));

app.get("/health", (req, res) => res.json({ ok: true, service: "transport-request-api" }));

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
  await initSchema();
  app.listen(env.PORT, () => {
    console.log(`API running on port ${env.PORT}`);
  });
})();