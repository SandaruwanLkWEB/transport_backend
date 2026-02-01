const express = require("express");
const { z } = require("zod");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { validate } = require("../utils/validate");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("ADMIN"));

// ---- HOD registrations (Admin approval) ----
router.get("/hod-registrations", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT id, email, department_id, status, created_at FROM users WHERE role='HOD' AND status='PENDING_ADMIN' ORDER BY created_at"
  );
  res.json({ ok: true, pending_hod: r.rows });
}));

router.post("/hod-registrations/:id/approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = await query("SELECT id, employee_id FROM users WHERE id=$1 AND role='HOD' AND status='PENDING_ADMIN'", [id]);
  if (u.rowCount === 0) throw httpError(404, "Pending HOD not found");
  await query("UPDATE users SET status='ACTIVE' WHERE id=$1", [id]);
  if (u.rows[0].employee_id) await query("UPDATE employees SET is_active=true WHERE id=$1", [u.rows[0].employee_id]);
  res.json({ ok: true });
}));

router.post("/hod-registrations/:id/reject", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = await query("SELECT id FROM users WHERE id=$1 AND role='HOD' AND status='PENDING_ADMIN'", [id]);
  if (u.rowCount === 0) throw httpError(404, "Pending HOD not found");
  await query("UPDATE users SET status='DISABLED' WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// Departments
router.get("/departments", asyncHandler(async (req, res) => {
  const r = await query("SELECT * FROM departments ORDER BY name");
  res.json({ ok: true, departments: r.rows });
}));

const depSchema = z.object({ body: z.object({ name: z.string().min(2) }) });

router.post("/departments", validate(depSchema), asyncHandler(async (req, res) => {
  const r = await query("INSERT INTO departments (name) VALUES ($1) RETURNING *", [req.body.name]);
  res.json({ ok: true, department: r.rows[0] });
}));

router.patch("/departments/:id", validate(depSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE departments SET name=$1 WHERE id=$2 RETURNING *", [req.body.name, id]);
  if (r.rowCount === 0) throw httpError(404, "Department not found");
  res.json({ ok: true, department: r.rows[0] });
}));

router.delete("/departments/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM departments WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// Routes
const routeSchema = z.object({ body: z.object({ route_no: z.string().min(1), route_name: z.string().min(1) }) });

router.get("/routes", asyncHandler(async (req, res) => {
  const r = await query("SELECT * FROM routes ORDER BY route_no");
  res.json({ ok: true, routes: r.rows });
}));

router.post("/routes", validate(routeSchema), asyncHandler(async (req, res) => {
  const r = await query("INSERT INTO routes (route_no, route_name) VALUES ($1,$2) RETURNING *", [req.body.route_no, req.body.route_name]);
  res.json({ ok: true, route: r.rows[0] });
}));

router.patch("/routes/:id", validate(routeSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE routes SET route_no=$1, route_name=$2 WHERE id=$3 RETURNING *", [req.body.route_no, req.body.route_name, id]);
  if (r.rowCount === 0) throw httpError(404, "Route not found");
  res.json({ ok: true, route: r.rows[0] });
}));

router.delete("/routes/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM routes WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// SubRoutes (max 50 per route enforced here)
const subSchema = z.object({ body: z.object({ sub_name: z.string().min(1) }) });

router.get("/routes/:routeId/subroutes", asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const r = await query("SELECT * FROM sub_routes WHERE route_id=$1 ORDER BY sub_name", [routeId]);
  res.json({ ok: true, subroutes: r.rows });
}));

router.post("/routes/:routeId/subroutes", validate(subSchema), asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const c = await query("SELECT COUNT(*)::int AS n FROM sub_routes WHERE route_id=$1", [routeId]);
  if (c.rows[0].n >= 50) throw httpError(400, "Max 50 sub-routes per route");

  const r = await query("INSERT INTO sub_routes (route_id, sub_name) VALUES ($1,$2) RETURNING *", [routeId, req.body.sub_name]);
  res.json({ ok: true, subroute: r.rows[0] });
}));


// Bulk upsert sub-routes (grams) for a route: accepts { sub_names: ["A","B"] } or { lines: "A\nB" }
const bulkSubSchema = z.object({
  body: z.object({
    sub_names: z.array(z.string().min(1)).optional(),
    lines: z.string().optional()
  })
});

router.post("/routes/:routeId/subroutes/bulk", validate(bulkSubSchema), asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  let names = [];
  if (Array.isArray(req.body.sub_names)) names = req.body.sub_names;
  if (typeof req.body.lines === "string") {
    names = names.concat(req.body.lines.split(/\r?\n/));
  }
  names = names.map(s => String(s).trim()).filter(Boolean);

  // dedupe
  const seen = new Set();
  names = names.filter(n => (seen.has(n) ? false : (seen.add(n), true)));

  if (names.length === 0) throw httpError(400, "No sub-route names");

  const c = await query("SELECT COUNT(*)::int AS n FROM sub_routes WHERE route_id=$1", [routeId]);
  if (c.rows[0].n + names.length > 50) throw httpError(400, "Max 50 sub-routes per route");

  // Insert with ON CONFLICT DO NOTHING
  const values = [];
  const params = [];
  let i = 1;
  for (const n of names) {
    params.push(routeId, n);
    values.push(`($${i++},$${i++})`);
  }
  const sql = `INSERT INTO sub_routes (route_id, sub_name) VALUES ${values.join(",")} ON CONFLICT (route_id, sub_name) DO NOTHING`;
  const ins = await query(sql, params);
  const after = await query("SELECT COUNT(*)::int AS n FROM sub_routes WHERE route_id=$1", [routeId]);

  res.json({ ok: true, inserted: ins.rowCount, total: after.rows[0].n });
}));

router.patch("/subroutes/:id", validate(subSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE sub_routes SET sub_name=$1 WHERE id=$2 RETURNING *", [req.body.sub_name, id]);
  if (r.rowCount === 0) throw httpError(404, "Sub-route not found");
  res.json({ ok: true, subroute: r.rows[0] });
}));

router.delete("/subroutes/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM sub_routes WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// Requests view + approve
router.get("/requests", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT tr.*, d.name as department_name FROM transport_requests tr JOIN departments d ON d.id=tr.department_id ORDER BY request_date DESC, created_at DESC LIMIT 100"
  );
  res.json({ ok: true, requests: r.rows });
}));

router.get("/requests/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query(
    "SELECT tr.*, d.name as department_name FROM transport_requests tr JOIN departments d ON d.id=tr.department_id WHERE tr.id=$1",
    [id]
  );
  if (r.rowCount === 0) throw httpError(404, "Request not found");

  const emps = await query(
    `SELECT e.emp_no, e.full_name, tre.effective_route_id, tre.effective_sub_route_id
     FROM transport_request_employees tre
     JOIN employees e ON e.id=tre.employee_id
     WHERE tre.request_id=$1
     ORDER BY e.full_name`,
    [id]
  );
  res.json({ ok: true, request: r.rows[0], employees: emps.rows });
}));


router.post("/requests/:id/approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (r.rows[0].status !== "SUBMITTED") throw httpError(400, "Only SUBMITTED can be approved");

  await query("UPDATE transport_requests SET status='ADMIN_APPROVED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'ADMIN_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

module.exports = router;
