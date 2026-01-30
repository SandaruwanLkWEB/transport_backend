const express = require("express");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("HR"));

router.get("/requests/ta-assigned", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT tr.*, d.name as department_name FROM transport_requests tr JOIN departments d ON d.id=tr.department_id WHERE tr.status='TA_ASSIGNED' ORDER BY tr.request_date DESC, tr.created_at DESC LIMIT 50"
  );
  res.json({ ok: true, requests: r.rows });
}));

router.post("/requests/:id/final-approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (r.rows[0].status !== "TA_ASSIGNED") throw httpError(400, "Only TA_ASSIGNED can be final approved");

  await query("UPDATE transport_requests SET status='HR_FINAL_APPROVED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_FINAL_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

module.exports = router;
