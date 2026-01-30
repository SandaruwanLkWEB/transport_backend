const express = require("express");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired);

// Routes + sub-routes tree (for dropdowns)
router.get("/routes-tree", asyncHandler(async (req, res) => {
  const routes = await query("SELECT id, route_no, route_name FROM routes ORDER BY route_no::int NULLS LAST, route_no, route_name");
  const subs = await query("SELECT id, route_id, sub_name FROM sub_routes ORDER BY route_id, sub_name");
  res.json({ ok: true, routes: routes.rows, sub_routes: subs.rows });
}));

module.exports = router;
