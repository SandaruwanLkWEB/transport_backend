const express = require("express");
const { DateTime } = require("luxon");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("EMP"));

router.get("/today-transport", asyncHandler(async (req, res) => {
  const empId = req.user.employee_id;
  if (!empId) return res.json({ ok: true, has_transport: false });

  const today = DateTime.now().setZone("Asia/Colombo").toISODate();

  const reqRow = await query(
    `SELECT tr.id, tr.request_date, tr.request_time
     FROM transport_requests tr
     JOIN transport_request_employees tre ON tre.request_id=tr.id
     WHERE tr.status='HR_FINAL_APPROVED' AND tr.request_date=$1 AND tre.employee_id=$2
     ORDER BY tr.request_time DESC
     LIMIT 1`,
    [today, empId]
  );

  if (reqRow.rowCount === 0) {
    return res.json({ ok: true, has_transport: false });
  }

  const requestId = reqRow.rows[0].id;

  const tre = await query(
    "SELECT effective_route_id, effective_sub_route_id FROM transport_request_employees WHERE request_id=$1 AND employee_id=$2",
    [requestId, empId]
  );

  const routeId = tre.rows[0].effective_route_id;
  const subId = tre.rows[0].effective_sub_route_id;

  const routeInfo = await query("SELECT id, route_no, route_name FROM routes WHERE id=$1", [routeId]);
  const subInfo = subId ? await query("SELECT id, sub_name FROM sub_routes WHERE id=$1", [subId]) : { rows: [] };

  const assignments = await query(
    `SELECT ra.id, v.vehicle_no, ra.driver_name, ra.driver_phone, ra.instructions
     FROM request_assignments ra
     JOIN vehicles v ON v.id=ra.vehicle_id
     WHERE ra.request_id=$1 AND ra.route_id IS NOT DISTINCT FROM $2 AND ra.sub_route_id IS NOT DISTINCT FROM $3
     ORDER BY ra.id`,
    [requestId, routeId, subId]
  );

  res.json({
    ok: true,
    has_transport: true,
    date: today,
    route: routeInfo.rows[0] || null,
    sub_route: subInfo.rows[0] || null,
    vehicles: assignments.rows.map(a => ({
      vehicle_no: a.vehicle_no,
      driver_name: a.driver_name,
      driver_phone: a.driver_phone,
      instructions: a.instructions
    }))
  });
}));

module.exports = router;
