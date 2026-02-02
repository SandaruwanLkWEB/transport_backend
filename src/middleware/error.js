const { env } = require("../config/env");

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.expose ? err.message : "Server error";

  // Always log to server logs (Railway) so we can debug 500s.
  // Do not leak stack traces to the client in production.
  try {
    console.error(
      `[ERROR] ${status} ${req.method} ${req.originalUrl} :: ${err.message}`
    );
    if (env.NODE_ENV !== "production") {
      console.error(err.stack || err);
    }
  } catch (_) {}

  res.status(status).json({
    ok: false,
    error: message,
    ...(env.NODE_ENV !== "production"
      ? { detail: err.message, stack: err.stack }
      : {})
  });
}

module.exports = { errorHandler };
