const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const parts = h.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(parts[1], env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}

module.exports = { authRequired };
