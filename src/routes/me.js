const express = require("express");
const { authRequired } = require("../middleware/auth");
const { query } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", authRequired, asyncHandler(async (req, res) => {
  const u = await query(
    "SELECT id, email, role, status, department_id, employee_id FROM users WHERE id=$1",
    [req.user.user_id]
  );
  res.json({ ok: true, me: u.rows[0] || null });
}));

module.exports = router;
