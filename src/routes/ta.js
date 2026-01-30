const express = require("express");
const { z } = require("zod");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { validate } = require("../utils/validate");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("TA"));

// Vehicles
const vehicleSchema = z.object({
  body: z.object({
    vehicle_no: z.string().min(1),
    vehicle_type: z.enum(["VAN","BUS","TUKTUK"]),
    capacity: z.coerce.number().int().positive(),
    owner_name: z.string().min(2),
    route_ids: z.array(z.coerce.number().int().positive()).optional()
  })
});

router.get("/vehicles", asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT v.*,
            COALESCE(array_agg(vr.route_id) FILTER (WHERE vr.route_id IS NOT NULL), '{}'::int[]) AS route_ids
     FROM vehicles v
     LEFT JOIN vehicle_routes vr ON vr.vehicle_id=v.id
     GROUP BY v.id
     ORDER BY v.vehicle_no`
  );
  res.json({ ok: true, vehicles: r.rows });
}));

router.post("/vehicles", validate(vehicleSchema), asyncHandler(async (req, res) => {
  const { vehicle_no, vehicle_type, capacity, owner_name, route_ids = [] } = req.body;
  const v = await query(
    "INSERT INTO vehicles (vehicle_no, vehicle_type, capacity, owner_name) VALUES ($1,$2,$3,$4) RETURNING *",
    [vehicle_no, vehicle_type, capacity, owner_name]
  );
  for (const rid of route_ids) {
    await query("INSERT INTO vehicle_routes (vehicle_id, route_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [v.rows[0].id, rid]);
  }
  res.json({ ok: true, vehicle: v.rows[0] });
}));

router.patch("/vehicles/:id", validate(vehicleSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { vehicle_no, vehicle_type, capacity, owner_name, route_ids = [] } = req.body;

  const v = await query(
    "UPDATE vehicles SET vehicle_no=$1, vehicle_type=$2, capacity=$3, owner_name=$4 WHERE id=$5 RETURNING *",
    [vehicle_no, vehicle_type, capacity, owner_name, id]
  );
  if (v.rowCount === 0) throw httpError(404, "Vehicle not found");

  // replace routes coverage
  await query("DELETE FROM vehicle_routes WHERE vehicle_id=$1", [id]);
  for (const rid of route_ids) {
    await query("INSERT INTO vehicle_routes (vehicle_id, route_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, rid]);
  }

  res.json({ ok: true, vehicle: v.rows[0] });
}));

router.delete("/vehicles/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM vehicles WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// Approved requests list
router.get("/requests/approved", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT tr.*, d.name as department_name FROM transport_requests tr JOIN departments d ON d.id=tr.department_id WHERE tr.status='ADMIN_APPROVED' ORDER BY tr.request_date DESC, tr.created_at DESC LIMIT 50"
  );
  res.json({ ok: true, requests: r.rows });
}));

// Route/Sub groups with headcount (automatic grouping)
router.get("/requests/:id/groups", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["ADMIN_APPROVED","TA_ASSIGNED","HR_FINAL_APPROVED"].includes(r.rows[0].status)) throw httpError(400, "Not ready for TA");

  const g = await query(
    `SELECT r.id as route_id, r.route_no, r.route_name,
            sr.id as sub_route_id, sr.sub_name,
            COUNT(*)::int as headcount
     FROM transport_request_employees tre
     LEFT JOIN routes r ON r.id = tre.effective_route_id
     LEFT JOIN sub_routes sr ON sr.id = tre.effective_sub_route_id
     WHERE tre.request_id=$1
     GROUP BY r.id, r.route_no, r.route_name, sr.id, sr.sub_name
     ORDER BY r.route_no NULLS LAST, sr.sub_name NULLS LAST`,
    [id]
  );

  res.json({ ok: true, groups: g.rows });
}));

// Existing assignments for a request (for UI edit)
router.get("/requests/:id/assignments", asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [requestId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["ADMIN_APPROVED","TA_ASSIGNED","HR_FINAL_APPROVED"].includes(r.rows[0].status)) throw httpError(400, "Not ready for TA");

  const rows = await query(
    `SELECT ra.route_id, ra.sub_route_id, ra.vehicle_id, ra.driver_name, ra.driver_phone, ra.instructions,
            v.vehicle_no, v.capacity
     FROM request_assignments ra
     JOIN vehicles v ON v.id = ra.vehicle_id
     WHERE ra.request_id=$1
     ORDER BY ra.route_id NULLS LAST, ra.sub_route_id NULLS LAST, v.vehicle_no`,
    [requestId]
  );
  res.json({ ok: true, assignments: rows.rows });
}));


// Save assignments for one group
const assignSchema = z.object({
  body: z.object({
    route_id: z.coerce.number().int().positive(),
    sub_route_id: z.coerce.number().int().positive().nullable().optional(),
    assignments: z.array(z.object({
      vehicle_id: z.coerce.number().int().positive(),
      driver_name: z.string().min(2),
      driver_phone: z.string().min(7),
      instructions: z.string().optional()
    })).min(1)
  })
});

router.post("/requests/:id/assignments", validate(assignSchema), asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const { route_id, sub_route_id = null, assignments } = req.body;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [requestId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["ADMIN_APPROVED","TA_ASSIGNED"].includes(r.rows[0].status)) throw httpError(400, "Not allowed");

  // Replace existing for that group
  await query(
    "DELETE FROM request_assignments WHERE request_id=$1 AND route_id=$2 AND (sub_route_id IS NOT DISTINCT FROM $3)",
    [requestId, route_id, sub_route_id]
  );

  for (const a of assignments) {
    await query(
      `INSERT INTO request_assignments
       (request_id, route_id, sub_route_id, vehicle_id, driver_name, driver_phone, instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [requestId, route_id, sub_route_id, a.vehicle_id, a.driver_name, a.driver_phone, a.instructions || null]
    );
  }

  res.json({ ok: true });
}));

// Submit TA assignments with capacity validation for all groups
router.post("/requests/:id/submit", asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [requestId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["ADMIN_APPROVED","TA_ASSIGNED"].includes(r.rows[0].status)) throw httpError(400, "Invalid status");

  // Compute headcounts
  const groups = await query(
    `SELECT tre.effective_route_id as route_id, tre.effective_sub_route_id as sub_route_id, COUNT(*)::int as headcount
     FROM transport_request_employees tre
     WHERE tre.request_id=$1
     GROUP BY tre.effective_route_id, tre.effective_sub_route_id`,
    [requestId]
  );

  for (const g of groups.rows) {
    // Sum vehicle capacities assigned for that group
    const caps = await query(
      `SELECT COALESCE(SUM(v.capacity),0)::int as capacity
       FROM request_assignments ra
       JOIN vehicles v ON v.id=ra.vehicle_id
       WHERE ra.request_id=$1 AND ra.route_id IS NOT DISTINCT FROM $2 AND ra.sub_route_id IS NOT DISTINCT FROM $3`,
      [requestId, g.route_id, g.sub_route_id]
    );

    const cap = caps.rows[0].capacity;
    if (cap < g.headcount) {
      throw httpError(400, `Capacity not enough for route_id=${g.route_id || "NULL"} sub_route_id=${g.sub_route_id || "NULL"} (need ${g.headcount}, have ${cap})`);
    }
  }

  await query("UPDATE transport_requests SET status='TA_ASSIGNED' WHERE id=$1", [requestId]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'TA_SUBMIT')", [requestId, userId]);

  res.json({ ok: true });
}));

module.exports = router;
