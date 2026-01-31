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

// Railway (and most PaaS) runs behind a reverse proxy and sets X-Forwarded-* headers.
// express-rate-limit will error if X-Forwarded-For exists but trust proxy is disabled.
// We only need the first proxy hop.
app.set("trust proxy", 1);

app.use(pinoHttp());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// CORS allowlist (supports full origins, hostname-only entries, and wildcard *.domain.com)
function getHostname(origin) {
  try { return new URL(origin).hostname.toLowerCase(); } catch (e) { return ""; }
}
function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/postman
  if (env.ALLOWED_ORIGINS.length === 0) return true;

  const o = origin.trim();
  const oh = getHostname(o);

  for (const raw of env.ALLOWED_ORIGINS) {
    const a = (raw || "").trim();
    if (!a) continue;
    if (a === "*") return true;

    // wildcard host: *.example.com
    if (a.startsWith("*.")) {
      const base = a.slice(2).toLowerCase();
      if (oh && (oh === base || oh.endsWith(`.${base}`))) return true;
      continue;
    }

    // exact origin match
    if (a.toLowerCase() === o.toLowerCase()) return true;

    // hostname-only allow (example.com)
    if (!a.startsWith("http")) {
      const host = a.toLowerCase();
      if (oh && (oh === host)) return true;
      continue;
    }

    // allow by hostname of an origin entry
    const ah = getHostname(a);
    if (ah && oh && ah === oh) return true;
  }

  return false;
}

app.use(cors({
  origin: function (origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(Object.assign(new Error("CORS blocked"), { status: 403, expose: true }), false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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