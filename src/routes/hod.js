const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { validate } = require("../utils/validate");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("HOD"));

// ---- Employees ----
const employeeCreateSchema = z.object({
  body: z.object({
    full_name: z.string().min(2),
    emp_no: z.string().min(1),
    default_route_id: z.coerce.number().int().positive().nullable().optional(),
    default_sub_route_id: z.coerce.number().int().positive().nullable().optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional()
  })
});

router.get("/employees", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const r = await query(
    "SELECT id, emp_no, full_name, department_id, default_route_id, default_sub_route_id, is_active FROM employees WHERE department_id=$1 ORDER BY full_name",
    [depId]
  );
  res.json({ ok: true, employees: r.rows });
}));

router.post("/employees", validate(employeeCreateSchema), asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  if (!depId) throw httpError(400, "HOD has no department_id");

  const { full_name, emp_no, default_route_id = null, default_sub_route_id = null, email, password } = req.body;

  const empExists = await query("SELECT id FROM employees WHERE emp_no=$1", [emp_no]);
  if (empExists.rowCount > 0) throw httpError(409, "emp_no already exists");

  const emp = await query(
    "INSERT INTO employees (emp_no, full_name, department_id, default_route_id, default_sub_route_id, is_active) VALUES ($1,$2,$3,$4,$5,true) RETURNING *",
    [emp_no, full_name, depId, default_route_id, default_sub_route_id]
  );

  // If email+password provided: create EMP user ACTIVE immediately
  let user = null;
  if (email && password) {
    const uExists = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (uExists.rowCount > 0) throw httpError(409, "Email already exists");
    const hash = await bcrypt.hash(password, 12);
    const u = await query(
      "INSERT INTO users (email, password_hash, role, status, department_id, employee_id) VALUES ($1,$2,'EMP','ACTIVE',$3,$4) RETURNING id, email, role, status",
      [email, hash, depId, emp.rows[0].id]
    );
    user = u.rows[0];
  }

  res.json({ ok: true, employee: emp.rows[0], user });
}));

const employeeUpdateSchema = z.object({
  body: z.object({
    full_name: z.string().min(2).optional(),
    default_route_id: z.coerce.number().int().positive().nullable().optional(),
    default_sub_route_id: z.coerce.number().int().positive().nullable().optional(),
    is_active: z.boolean().optional()
  })
});

router.patch("/employees/:id", validate(employeeUpdateSchema), asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const id = parseInt(req.params.id, 10);

  const e = await query("SELECT * FROM employees WHERE id=$1 AND department_id=$2", [id, depId]);
  if (e.rowCount === 0) throw httpError(404, "Employee not found");

  const fields = [];
  const vals = [];
  let i = 1;
  for (const k of ["full_name","default_route_id","default_sub_route_id","is_active"]) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      fields.push(`${k}=$${i++}`);
      vals.push(req.body[k]);
    }
  }
  if (fields.length === 0) throw httpError(400, "No changes");

  vals.push(id, depId);
  const sql = `UPDATE employees SET ${fields.join(", ")} WHERE id=$${i++} AND department_id=$${i++} RETURNING *`;
  const upd = await query(sql, vals);

  res.json({ ok: true, employee: upd.rows[0] });
}));

// ---- Pending self-registrations ----
router.get("/registrations/pending", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const r = await query(
    "SELECT id, email, status, employee_id, created_at FROM users WHERE department_id=$1 AND role='EMP' AND status='PENDING_HOD' ORDER BY created_at",
    [depId]
  );
  res.json({ ok: true, pending: r.rows });
}));

router.post("/registrations/:id/approve", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const id = parseInt(req.params.id, 10);

  const u = await query("SELECT id, employee_id FROM users WHERE id=$1 AND department_id=$2 AND status='PENDING_HOD'", [id, depId]);
  if (u.rowCount === 0) throw httpError(404, "Pending registration not found");

  await query("UPDATE users SET status='ACTIVE' WHERE id=$1", [id]);
  if (u.rows[0].employee_id) {
    await query("UPDATE employees SET is_active=true WHERE id=$1", [u.rows[0].employee_id]);
  }
  res.json({ ok: true });
}));

// ---- Requests ----
const requestCreateSchema = z.object({
  body: z.object({
    request_date: z.string().min(10),   // YYYY-MM-DD
    request_time: z.string().min(4),   // HH:MM
    notes: z.string().optional(),
    employee_ids: z.array(z.coerce.number().int().positive()).min(1)
  })
});

router.post("/requests", validate(requestCreateSchema), asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const userId = req.user.user_id;
  const { request_date, request_time, notes = null, employee_ids } = req.body;

  // validate employees belong to HOD department
  const emps = await query(
    "SELECT id, default_route_id, default_sub_route_id FROM employees WHERE department_id=$1 AND id = ANY($2::int[])",
    [depId, employee_ids]
  );
  if (emps.rowCount !== employee_ids.length) throw httpError(400, "Some employees not found in your department");

  const reqRow = await query(
    "INSERT INTO transport_requests (request_date, request_time, department_id, created_by_user_id, status, notes) VALUES ($1,$2,$3,$4,'DRAFT',$5) RETURNING *",
    [request_date, request_time, depId, userId, notes]
  );

  for (const e of emps.rows) {
    await query(
      "INSERT INTO transport_request_employees (request_id, employee_id, effective_route_id, effective_sub_route_id) VALUES ($1,$2,$3,$4)",
      [reqRow.rows[0].id, e.id, e.default_route_id, e.default_sub_route_id]
    );
  }

  res.json({ ok: true, request: reqRow.rows[0] });
}));

router.get("/requests", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const r = await query(
    "SELECT id, request_date::text as request_date, request_time::text as request_time, department_id, created_by_user_id, status, notes, created_at, updated_at FROM transport_requests WHERE department_id=$1 ORDER BY request_date DESC, created_at DESC LIMIT 50",
    [depId]
  );
  res.json({ ok: true, requests: r.rows });
}));

router.get("/requests/:id", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const id = parseInt(req.params.id, 10);

  const r = await query("SELECT id, request_date::text as request_date, request_time::text as request_time, department_id, created_by_user_id, status, notes, created_at, updated_at FROM transport_requests WHERE id=$1 AND department_id=$2", [id, depId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");

  const items = await query(
    `SELECT tre.id, tre.employee_id, e.emp_no, e.full_name, tre.effective_route_id, tre.effective_sub_route_id
     FROM transport_request_employees tre
     JOIN employees e ON e.id = tre.employee_id
     WHERE tre.request_id=$1
     ORDER BY e.full_name`,
    [id]
  );

  res.json({ ok: true, request: r.rows[0], employees: items.rows });
}));

const requestUpdateEmployeesSchema = z.object({
  body: z.object({
    changes: z.array(z.object({
      employee_id: z.coerce.number().int().positive(),
      effective_route_id: z.coerce.number().int().positive().nullable().optional(),
      effective_sub_route_id: z.coerce.number().int().positive().nullable().optional(),
      remove: z.boolean().optional(),
      persist_to_employee: z.boolean().optional()
    })).min(1)
  })
});

// Allowed only before ADMIN_APPROVED
router.patch("/requests/:id/employees", validate(requestUpdateEmployeesSchema), asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const id = parseInt(req.params.id, 10);

  const r = await query("SELECT status FROM transport_requests WHERE id=$1 AND department_id=$2", [id, depId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["DRAFT","SUBMITTED"].includes(r.rows[0].status)) throw httpError(400, "Request is locked");

  for (const c of req.body.changes) {
    if (c.remove) {
      await query(
        "DELETE FROM transport_request_employees WHERE request_id=$1 AND employee_id=$2",
        [id, c.employee_id]
      );
      continue;
    }
    // update effective fields
    const upd = await query(
      "UPDATE transport_request_employees SET effective_route_id=COALESCE($3,effective_route_id), effective_sub_route_id=COALESCE($4,effective_sub_route_id) WHERE request_id=$1 AND employee_id=$2 RETURNING employee_id, effective_route_id, effective_sub_route_id",
      [id, c.employee_id, c.effective_route_id ?? null, c.effective_sub_route_id ?? null]
    );
    if (upd.rowCount === 0) throw httpError(404, "Employee not in request");

    if (c.persist_to_employee) {
      await query(
        "UPDATE employees SET default_route_id=$2, default_sub_route_id=$3 WHERE id=$1 AND department_id=$4",
        [c.employee_id, upd.rows[0].effective_route_id, upd.rows[0].effective_sub_route_id, depId]
      );
    }
  }

  res.json({ ok: true });
}));

router.post("/requests/:id/submit", asyncHandler(async (req, res) => {
  const depId = req.user.department_id;
  const userId = req.user.user_id;
  const id = parseInt(req.params.id, 10);

  const r = await query("SELECT status FROM transport_requests WHERE id=$1 AND department_id=$2", [id, depId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (!["DRAFT","SUBMITTED"].includes(r.rows[0].status)) throw httpError(400, "Invalid status");
  await query("UPDATE transport_requests SET status='SUBMITTED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'SUBMIT')", [id, userId]);
  res.json({ ok: true });
}));

module.exports = router;
