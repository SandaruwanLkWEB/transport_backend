const express = require("express");
const { z } = require("zod");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { validate } = require("../utils/validate");
const asyncHandler = require("../utils/asyncHandler");


function nowHHMM(timeZone = "Asia/Colombo") {
  // Returns HH:MM in the given time zone (24h)
  try {
    return new Date().toLocaleTimeString("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    // Fallback (server local time)
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}
const router = express.Router();
router.use(authRequired, requireRole("ADMIN", "HR"));  // Allow HR to access these too

// Departments
router.get("/departments", asyncHandler(async (req, res) => {
  const r = await query("SELECT * FROM departments ORDER BY name");
  res.json({ ok: true, departments: r.rows });
}));

const depSchema = z.object({ body: z.object({ name: z.string().min(2) }) });

router.post("/departments", requireRole("ADMIN"), validate(depSchema), asyncHandler(async (req, res) => {
  const r = await query("INSERT INTO departments (name) VALUES ($1) RETURNING *", [req.body.name]);
  res.json({ ok: true, department: r.rows[0] });
}));

const updateDepartment = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE departments SET name=$1 WHERE id=$2 RETURNING *", [req.body.name, id]);
  if (r.rowCount === 0) throw httpError(404, "Department not found");
  res.json({ ok: true, department: r.rows[0] });
});

router.patch("/departments/:id", requireRole("ADMIN"), validate(depSchema), updateDepartment);
router.put("/departments/:id", requireRole("ADMIN"), validate(depSchema), updateDepartment);


router.delete("/departments/:id", requireRole("ADMIN"), asyncHandler(async (req, res) => {
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

router.post("/routes", requireRole("ADMIN"), validate(routeSchema), asyncHandler(async (req, res) => {
  const r = await query("INSERT INTO routes (route_no, route_name) VALUES ($1,$2) RETURNING *", [req.body.route_no, req.body.route_name]);
  res.json({ ok: true, route: r.rows[0] });
}));

const updateRoute = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE routes SET route_no=$1, route_name=$2 WHERE id=$3 RETURNING *", [req.body.route_no, req.body.route_name, id]);
  if (r.rowCount === 0) throw httpError(404, "Route not found");
  res.json({ ok: true, route: r.rows[0] });
});

router.patch("/routes/:id", requireRole("ADMIN"), validate(routeSchema), updateRoute);
router.put("/routes/:id", requireRole("ADMIN"), validate(routeSchema), updateRoute);


router.delete("/routes/:id", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM routes WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// SubRoutes
const subSchema = z.object({ body: z.object({ sub_name: z.string().min(1) }) });

router.get("/routes/:routeId/subroutes", asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const r = await query("SELECT * FROM sub_routes WHERE route_id=$1 ORDER BY sub_name", [routeId]);
  res.json({ ok: true, subroutes: r.rows });
}));

router.post("/routes/:routeId/subroutes", requireRole("ADMIN"), validate(subSchema), asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const c = await query("SELECT COUNT(*)::int AS n FROM sub_routes WHERE route_id=$1", [routeId]);
  if (c.rows[0].n >= 50) throw httpError(400, "Max 50 sub-routes per route");

  const r = await query("INSERT INTO sub_routes (route_id, sub_name) VALUES ($1,$2) RETURNING *", [routeId, req.body.sub_name]);
  res.json({ ok: true, subroute: r.rows[0] });
}));

const updateSubroute = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query("UPDATE sub_routes SET sub_name=$1 WHERE id=$2 RETURNING *", [req.body.sub_name, id]);
  if (r.rowCount === 0) throw httpError(404, "Sub-route not found");
  res.json({ ok: true, subroute: r.rows[0] });
});

router.patch("/subroutes/:id", requireRole("ADMIN"), validate(subSchema), updateSubroute);
router.put("/subroutes/:id", requireRole("ADMIN"), validate(subSchema), updateSubroute);


router.delete("/subroutes/:id", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query("DELETE FROM sub_routes WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// Bulk Subroutes Upload
const bulkSubSchema = z.object({ body: z.object({ lines: z.string().min(1) }) });

router.post("/routes/:routeId/subroutes/bulk", requireRole("ADMIN"), validate(bulkSubSchema), asyncHandler(async (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const lines = req.body.lines.split('\n').map(l => l.trim()).filter(Boolean);
  
  if (lines.length === 0) throw httpError(400, "ග්‍රාම නාම එකතු කරන්න");
  if (lines.length > 50) throw httpError(400, "Max 50 sub-routes per route");
  
  let inserted = 0;
  for (const line of lines) {
    try {
      await query(
        "INSERT INTO sub_routes (route_id, sub_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [routeId, line]
      );
      inserted++;
    } catch (e) {
      // Skip duplicates
      console.log(`Skipped duplicate: ${line}`);
    }
  }
  
  res.json({ ok: true, inserted, total: lines.length });
}));

// Requests view + approve
router.get("/requests", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT tr.*, COALESCE(d.name,'සියලු දෙපාර්තමේන්තු') as department_name FROM transport_requests tr LEFT JOIN departments d ON d.id=tr.department_id ORDER BY request_date DESC, created_at DESC LIMIT 100"
  );
  res.json({ ok: true, requests: r.rows });
}));

router.get("/requests/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query(
    "SELECT tr.*, COALESCE(d.name,'සියලු දෙපාර්තමේන්තු') as department_name FROM transport_requests tr LEFT JOIN departments d ON d.id=tr.department_id WHERE tr.id=$1",
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

// NEW: Get employees for a request (for HR detail view)
router.get("/requests/:id/employees", asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  
  const employees = await query(
    `SELECT 
       tre.id,
       e.emp_no,
       e.full_name,
       r.id as route_id,
       r.route_no,
       r.route_name,
       sr.id as sub_route_id,
       sr.sub_name,
       tre.effective_route_id,
       tre.effective_sub_route_id
     FROM transport_request_employees tre
     JOIN employees e ON e.id = tre.employee_id
     LEFT JOIN routes r ON r.id = tre.effective_route_id
     LEFT JOIN sub_routes sr ON sr.id = tre.effective_sub_route_id
     WHERE tre.request_id = $1
     ORDER BY r.route_no NULLS LAST, sr.sub_name NULLS LAST, e.full_name`,
    [requestId]
  );
  
  res.json({ ok: true, employees: employees.rows });
}));

// NEW: Get vehicle assignments summary for a request (for HR detail view)
router.get("/requests/:id/assignments-summary", asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  
  const assignments = await query(
    `SELECT 
       ra.id,
       ra.route_id,
       r.route_no,
       r.route_name,
       ra.vehicle_id,
       v.vehicle_no,
       v.capacity,
       ra.driver_name,
       ra.driver_phone,
       ra.instructions,
       ra.overbook_amount,
       ra.overbook_reason,
       ra.overbook_status
     FROM request_assignments ra
     JOIN vehicles v ON v.id = ra.vehicle_id
     LEFT JOIN routes r ON r.id = ra.route_id
     WHERE ra.request_id = $1
     ORDER BY r.route_no NULLS LAST, v.vehicle_no`,
    [requestId]
  );
  
  res.json({ ok: true, assignments: assignments.rows });
}));

router.post("/requests/:id/approve", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (r.rows[0].status !== "SUBMITTED") throw httpError(400, "Only SUBMITTED can be approved");

  await query("UPDATE transport_requests SET status='ADMIN_APPROVED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'ADMIN_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

// Daily Run
router.get("/run/:date/summary", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const runDate = req.params.date;
  const deps = await query("SELECT id, name FROM departments ORDER BY name ASC");
  const sub = await query(
    "SELECT department_id, COUNT(*)::int as req_count, COALESCE(SUM((SELECT COUNT(*) FROM transport_request_employees tre WHERE tre.request_id = tr.id)),0)::int as emp_count " +
    "FROM transport_requests tr WHERE tr.request_date=$1 AND tr.is_daily_master=FALSE AND tr.status IN ('SUBMITTED','ADMIN_APPROVED') GROUP BY department_id",
    [runDate]
  );
  const byDep = new Map(sub.rows.map(r => [r.department_id, r]));
  const rows = deps.rows.map(d => {
    const s = byDep.get(d.id);
    return {
      department_id: d.id,
      department_name: d.name,
      submitted: !!s,
      requests_count: s ? s.req_count : 0,
      employees_count: s ? s.emp_count : 0
    };
  });
  const missing = rows.filter(r => !r.submitted).map(r => r.department_name);

  const master = await query(
    "SELECT id, status FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE",
    [runDate]
  );

  res.json({
    ok: true,
    date: runDate,
    master_request: master.rowCount ? master.rows[0] : null,
    submitted_departments: rows.filter(r=>r.submitted).length,
    missing_departments: missing,
    departments: rows
  });
}));

router.post("/run/:date/lock", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const runDate = req.params.date;
  const userId = req.user.user_id;

  const existingMaster = await query(
    "SELECT id, status FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE",
    [runDate]
  );
  if (existingMaster.rowCount) {
    const st = existingMaster.rows[0].status;
    if (['TA_ASSIGNED_PENDING_HR','TA_ASSIGNED','TA_FIX_REQUIRED','HR_FINAL_APPROVED'].includes(st)) {
      throw httpError(400, "Run already in progress; cannot re-lock");
    }
  }

  await query(
    "UPDATE transport_requests SET status='ADMIN_APPROVED' WHERE request_date=$1 AND is_daily_master=FALSE AND status='SUBMITTED'",
    [runDate]
  );

  let masterId;
  if (existingMaster.rowCount) {
    masterId = existingMaster.rows[0].id;
    await query(
      "UPDATE transport_requests SET status='ADMIN_APPROVED', request_time='00:00', department_id=NULL, notes=COALESCE(notes,'') WHERE id=$1",
      [masterId]
    );
    await query("DELETE FROM transport_request_employees WHERE request_id=$1", [masterId]);
  } else {
    const ins = await query(
      "INSERT INTO transport_requests (request_date, request_time, department_id, created_by_user_id, status, notes, is_daily_master) " +
      "VALUES ($1,'00:00',NULL,$2,'ADMIN_APPROVED','Daily Run (All Departments)',TRUE) RETURNING id",
      [runDate, userId]
    );
    masterId = ins.rows[0].id;
  }

  const emps = await query(
    "SELECT DISTINCT ON (tre.employee_id) tre.employee_id, tre.effective_route_id, tre.effective_sub_route_id " +
    "FROM transport_request_employees tre " +
    "JOIN transport_requests tr ON tr.id = tre.request_id " +
    "WHERE tr.request_date=$1 AND tr.is_daily_master=FALSE AND tr.status='ADMIN_APPROVED' " +
    "ORDER BY tre.employee_id, tr.created_at DESC",
    [runDate]
  );

  for (const e of emps.rows) {
    await query(
      "INSERT INTO transport_request_employees (request_id, employee_id, effective_route_id, effective_sub_route_id) VALUES ($1,$2,$3,$4)",
      [masterId, e.employee_id, e.effective_route_id, e.effective_sub_route_id]
    );
  }

  await query(
    "INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'ADMIN_LOCK_RUN')",
    [masterId, userId]
  );

  res.json({ ok: true, master_request_id: masterId, employees_added: emps.rowCount });
}));

module.exports = router;
