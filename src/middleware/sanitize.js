/**
 * Simple request-body sanitization to reduce common injection issues.
 * - Trims strings
 * - Removes null bytes
 * - Blocks prototype pollution keys
 */
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function sanitizeValue(v) {
  if (typeof v === "string") {
    // remove null bytes + trim
    return v.replace(/\u0000/g, "").trim();
  }
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === "object") return sanitizeObject(v);
  return v;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, val] of Object.entries(obj)) {
    if (BLOCKED_KEYS.has(k)) continue;
    out[k] = sanitizeValue(val);
  }
  return out;
}

function sanitize(req, res, next) {
  try {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeObject(req.query);
    }
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { sanitize };
