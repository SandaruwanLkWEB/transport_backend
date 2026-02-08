const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { query } = require("../db/pool");
const { httpError } = require("../utils/httpError");

/**
 * Extract Bearer token from Authorization header.
 */
function getToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Authenticate user if token present; otherwise continue.
 * Sets req.user = { id, role, status, department_id, employee_id, email }.
 */
async function attachUser(req) {
  const token = getToken(req);
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (e) {
    throw httpError(401, "Invalid token");
  }

  const userId = payload.user_id || payload.id;
  if (!userId) throw httpError(401, "Invalid token payload");

  // Always load latest user details from DB (role/status may change after token issued)
  const r = await query(
    "SELECT id, email, role, status, department_id, employee_id FROM users WHERE id=$1",
    [userId]
  );
  const u = r.rows[0];
  if (!u) throw httpError(401, "User not found");
  if (u.status && String(u.status).toUpperCase() !== "ACTIVE") {
    throw httpError(401, "Account not active");
  }

  req.user = {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    department_id: u.department_id,
    employee_id: u.employee_id,
  };
  return req.user;
}

function authOptional(req, res, next) {
  Promise.resolve()
    .then(() => attachUser(req))
    .then(() => next())
    .catch(next);
}

function authRequired(req, res, next) {
  Promise.resolve()
    .then(() => attachUser(req))
    .then((u) => {
      if (!u) throw httpError(401, "Unauthorized");
      next();
    })
    .catch(next);
}

module.exports = { authRequired, authOptional };
