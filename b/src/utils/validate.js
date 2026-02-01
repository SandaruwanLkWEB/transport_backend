const { ZodError } = require("zod");

function validate(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
        user: req.user
      });
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Validation error",
          issues: e.issues.map(i => ({ path: i.path, message: i.message }))
        });
      }
      next(e);
    }
  };
}

module.exports = { validate };
