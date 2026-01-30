const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { env } = require("./config/env");
const { errorHandler } = require("./middleware/error");

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

app.use(pinoHttp());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// CORS allowlist
app.use(cors({
  origin: function(origin, cb) {
    if (!origin) return cb(null, true); // curl/postman
    if (env.ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
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

app.listen(env.PORT, () => {
  console.log(`API running on port ${env.PORT}`);
});
