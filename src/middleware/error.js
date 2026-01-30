const { env } = require("../config/env");

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.expose ? err.message : "Server error";
  if (env.NODE_ENV !== "production") {
    console.error(err);
  }
  res.status(status).json({
    ok: false,
    error: message,
    ...(env.NODE_ENV !== "production" ? { detail: err.message, stack: err.stack } : {})
  });
}

module.exports = { errorHandler };
