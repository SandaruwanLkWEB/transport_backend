const express = require("express");
const { query } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Public department list for registration dropdown
router.get("/departments", asyncHandler(async (req, res) => {
  const r = await query("SELECT id, name FROM departments ORDER BY name");
  res.json({ ok: true, departments: r.rows });
}));

module.exports = router;
