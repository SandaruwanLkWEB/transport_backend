const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { env } = require("../config/env");
const { query } = require("../db/pool");
const { httpError } = require("../utils/httpError");
const { validate } = require("../utils/validate");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const registerSchema = z.object({
  body: z.object({
    emp_name: z.string().min(2),
    emp_no: z.string().min(1),
    email: z.string().email(),
    department_id: z.coerce.number().int().positive(),
    password: z.string().min(6)
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
});

function signToken(u) {
  const payload = {
    user_id: u.id,
    role: u.role,
    status: u.status,
    department_id: u.department_id,
    employee_id: u.employee_id
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "12h" });
}

// Self-registration: creates employee + user as EMP with PENDING_HOD status
router.post("/register", validate(registerSchema), asyncHandler(async (req, res) => {
  const { emp_name, emp_no, email, department_id, password } = req.body;

  const dep = await query("SELECT id FROM departments WHERE id=$1", [department_id]);
  if (dep.rowCount === 0) throw httpError(400, "Invalid department");

  const existing = await query("SELECT id FROM users WHERE email=$1", [email]);
  if (existing.rowCount > 0) throw httpError(409, "Email already exists");

  const empExists = await query("SELECT id FROM employees WHERE emp_no=$1", [emp_no]);
  if (empExists.rowCount > 0) throw httpError(409, "emp_no already exists");

  const hash = await bcrypt.hash(password, 12);

  const emp = await query(
    "INSERT INTO employees (emp_no, full_name, department_id, is_active) VALUES ($1,$2,$3,false) RETURNING id",
    [emp_no, emp_name, department_id]
  );

  const user = await query(
    "INSERT INTO users (email, password_hash, role, status, department_id, employee_id) VALUES ($1,$2,'EMP','PENDING_HOD',$3,$4) RETURNING id, role, status, department_id, employee_id",
    [email, hash, department_id, emp.rows[0].id]
  );

  res.json({ ok: true, status: "PENDING_HOD", user_id: user.rows[0].id });
}));

router.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const r = await query(
    "SELECT id, email, password_hash, role, status, department_id, employee_id FROM users WHERE email=$1",
    [email]
  );
  if (r.rowCount === 0) throw httpError(401, "Invalid credentials");
  const u = r.rows[0];
  if (u.status !== "ACTIVE") throw httpError(403, "Account not active");
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) throw httpError(401, "Invalid credentials");

  const token = signToken(u);
  res.json({ ok: true, token, role: u.role });
}));

module.exports = router;
