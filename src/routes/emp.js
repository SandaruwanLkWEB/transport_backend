const express = require("express");
const { DateTime } = require("luxon");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("EMP"));

router.get("/today-transport", requireAuth, requireRole("EMP"), async (req, res) => {
  try {
    // We rely on the EMP user's linked employee_id
    const employeeId = req.user.employee_id;
    if (!employeeId) {
      return res.json({ has_transport: false, message: "Employee record not linked." });
    }

    const today = DateTime.now().setZone("Asia/Colombo").toISODate();

    // Find today's DAILY MASTER request (vehicles are assigned on the master request)
    const master = await query(
      `SELECT id, request_time, status
       FROM transport_requests
       WHERE request_date=$1 AND is_daily_master=TRUE
         AND status IN ('LOCKED','ADMIN_APPROVED','TA_ASSIGNED_PENDING_HR','TA_ASSIGNED','HR_FINAL_APPROVED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [today]
    );

    if (master.rowCount === 0) {
      return res.json({ has_transport: false, message: "No daily run found for today." });
    }

    const requestId = master.rows[0].id;
    const request_time = master.rows[0].request_time;
    const status = master.rows[0].status;

    // Find this employee inside the master request (effective route/sub-route may be overridden)
    const tre = await query(
      `SELECT tre.effective_route_id, tre.effective_sub_route_id,
              e.default_route_id, e.default_sub_route_id
       FROM transport_request_employees tre
       JOIN employees e ON e.id = tre.employee_id
       WHERE tre.request_id=$1 AND tre.employee_id=$2
       LIMIT 1`,
      [requestId, employeeId]
    );

    if (tre.rowCount === 0) {
      return res.json({ has_transport: false, message: "You are not included in today's transport list." });
    }

    const routeId = tre.rows[0].effective_route_id || tre.rows[0].default_route_id;
    const subRouteId = tre.rows[0].effective_sub_route_id || tre.rows[0].default_sub_route_id;

    // Route + sub-route details
    const route = routeId
      ? await query("SELECT route_no, route_name FROM routes WHERE id=$1", [routeId])
      : { rowCount: 0, rows: [] };

    const sub = subRouteId
      ? await query("SELECT sub_name FROM sub_routes WHERE id=$1", [subRouteId])
      : { rowCount: 0, rows: [] };

    // Assigned vehicles for the employee's (route, sub-route) on the master request
    const assigns = await query(
      `SELECT v.vehicle_no, v.registration_no AS vehicle_registration_no, v.fleet_no, v.capacity,
              ra.driver_name, ra.driver_phone, ra.instructions
       FROM request_assignments ra
       JOIN vehicles v ON v.id = ra.vehicle_id
       WHERE ra.request_id=$1
         AND ra.route_id IS NOT DISTINCT FROM $2
         AND ra.sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY v.vehicle_no`,
      [requestId, routeId, subRouteId]
    );

    return res.json({
      has_transport: true,
      date: today,
      request_time,
      status,
      route: route.rowCount ? route.rows[0] : null,
      sub_route: sub.rowCount ? sub.rows[0] : null,
      vehicles: assigns.rows || []
    });
  } catch (err) {
    console.error("EMP today-transport error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
