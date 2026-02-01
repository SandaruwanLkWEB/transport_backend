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
    "SELECT tr.*, d.name as department_name FROM transport_requests tr JOIN departments d ON d.id=tr.department_id WHERE tr.status IN ('TA_ASSIGNED','TA_ASSIGNED_PENDING_HR') ORDER BY tr.request_date DESC, tr.created_at DESC LIMIT 50"
  );
  res.json({ ok: true, requests: r.rows });
}));


// Overbook override approval (vehicle capacity +1/+2) - HR gate
router.post("/requests/:id/overbook/approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED_PENDING_HR") throw httpError(400, "ඔවරයිඩ් අනුමැතිය අවශ්‍ය ඉල්ලීමක් නොවේ");

  await query("UPDATE request_assignments SET overbook_status='APPROVED' WHERE request_id=$1 AND COALESCE(overbook_amount,0) > 0", [id]);
  await query("UPDATE transport_requests SET status='TA_ASSIGNED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_OVERBOOK_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

router.post("/requests/:id/overbook/reject", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED_PENDING_HR") throw httpError(400, "ඔවරයිඩ් ප්‍රතික්ෂේප කළ හැක්කේ Pending HR ඉල්ලීම් සඳහා පමණයි");

  await query("UPDATE request_assignments SET overbook_status='REJECTED' WHERE request_id=$1 AND COALESCE(overbook_amount,0) > 0", [id]);
  await query("UPDATE transport_requests SET status='TA_FIX_REQUIRED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_OVERBOOK_REJECT')", [id, userId]);

  res.json({ ok: true, needs_fix: true });
}));


router.post("/requests/:id/final-approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED") throw httpError(400, "අවසාන අනුමැතිය දිය හැක්කේ TA_ASSIGNED ඉල්ලීම් සඳහා පමණයි (ඔවරයිඩ් Pending නම් පළමුව අනුමත/ප්‍රතික්ෂේප කරන්න)");

  await query("UPDATE transport_requests SET status='HR_FINAL_APPROVED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_FINAL_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

module.exports = router;
