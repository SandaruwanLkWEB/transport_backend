const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { env } = require("../config/env");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { sendOtpEmail } = require("../services/brevoEmail");
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

// Password reset via OTP (email or emp_no)
// Accept empty strings from some clients ("" => undefined) to avoid validation errors.
const emptyToUndefined = (v) => {
  if (typeof v === "string" && v.trim() === "") return undefined;
  return v;
};

const passwordResetRequestSchema = z.object({
  body: z.object({
    email: z.preprocess(emptyToUndefined, z.string().email().optional()),
    emp_no: z.preprocess(emptyToUndefined, z.string().min(1).optional())
  }).refine((v) => Boolean(v.email || v.emp_no), { message: "email or emp_no required" })
});

const passwordResetConfirmSchema = z.object({
  body: z.object({
    email: z.preprocess(emptyToUndefined, z.string().email().optional()),
    emp_no: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    otp: z.string().regex(/^\d{6}$/),
    new_password: z.string().min(6)
  }).refine((v) => Boolean(v.email || v.emp_no), { message: "email or emp_no required" })
});

async function findUserByEmailOrEmpNo({ email, emp_no }) {
  if (email) {
    const r = await query(
      "SELECT id, email, password_hash, role, status, department_id, employee_id FROM users WHERE lower(email)=lower($1)",
      [email]
    );
    return r.rowCount ? r.rows[0] : null;
  }
  if (emp_no) {
    const r = await query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.status, u.department_id, u.employee_id
       FROM users u
       JOIN employees e ON e.id = u.employee_id
       WHERE e.emp_no = $1`,
      [emp_no]
    );
    return r.rowCount ? r.rows[0] : null;
  }
  return null;
}

function makeOtp() {
  // 6-digit numeric OTP
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(String(salt) + String(otp)).digest("hex");
}

async function dailyResetCount(userId) {
  // Limit per day in Sri Lanka time
  const nowSL = DateTime.now().setZone("Asia/Colombo");
  const startUtc = nowSL.startOf("day").toUTC().toISO();
  const endUtc = nowSL.startOf("day").plus({ days: 1 }).toUTC().toISO();
  const r = await query(
    "SELECT COUNT(*)::int AS c FROM password_reset_requests WHERE user_id=$1 AND created_at >= $2 AND created_at < $3",
    [userId, startUtc, endUtc]
  );
  return r.rows?.[0]?.c || 0;
}

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

const registerHodSchema = z.object({
  body: z.object({
    hod_name: z.string().min(2),
    emp_no: z.string().min(1),
    email: z.string().email(),
    department_id: z.coerce.number().int().positive(),
    password: z.string().min(6)
  })
});

// HOD self-registration: creates employee + user as HOD with PENDING_ADMIN status (Admin must approve)
router.post("/register-hod", validate(registerHodSchema), asyncHandler(async (req, res) => {
  const { hod_name, emp_no, email, department_id, password } = req.body;

  const dep = await query("SELECT id FROM departments WHERE id=$1", [department_id]);
  if (dep.rowCount === 0) throw httpError(400, "Invalid department");

  const existing = await query("SELECT id FROM users WHERE email=$1", [email]);
  if (existing.rowCount > 0) throw httpError(409, "Email already exists");

  const empExists = await query("SELECT id FROM employees WHERE emp_no=$1", [emp_no]);
  if (empExists.rowCount > 0) throw httpError(409, "emp_no already exists");

  const hash = await bcrypt.hash(password, 12);

  const emp = await query(
    "INSERT INTO employees (emp_no, full_name, department_id, is_active) VALUES ($1,$2,$3,false) RETURNING id",
    [emp_no, hod_name, department_id]
  );

  const user = await query(
    "INSERT INTO users (email, password_hash, role, status, department_id, employee_id) VALUES ($1,$2,'HOD','PENDING_ADMIN',$3,$4) RETURNING id, role, status, department_id, employee_id",
    [email, hash, department_id, emp.rows[0].id]
  );

  res.json({ ok: true, status: "PENDING_ADMIN", user_id: user.rows[0].id });
}));

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

// Request OTP for password reset (email or emp_no)
router.post("/password-reset/request", validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  const { email, emp_no } = req.body;

  const u = await findUserByEmailOrEmpNo({ email, emp_no });
  if (!u) throw httpError(404, "Invalid email/emp no");
  if (u.status !== "ACTIVE") throw httpError(403, "Account not active");

  if (!u.email) throw httpError(400, "No email found for this account");

  const count = await dailyResetCount(u.id);
  if (count >= 3) throw httpError(429, "Password reset blocked for today");

  const otp = makeOtp();
  const salt = crypto.randomBytes(16).toString("hex");
  const otpHash = hashOtp(otp, salt);
  const expiresAt = DateTime.utc().plus({ minutes: 5 }).toISO();

  await query(
    "INSERT INTO password_reset_requests (user_id, otp_hash, otp_salt, expires_at, requested_ip) VALUES ($1,$2,$3,$4,$5)",
    [u.id, otpHash, salt, expiresAt, req.ip || null]
  );

  try {
    await sendOtpEmail({ toEmail: u.email, otp, minutes: 5 });
  } catch (e) {
    console.error("password-reset: brevo error:", e.message);
    throw httpError(500, "OTP email sending failed");
  }

  res.json({ ok: true, message: "OTP sent" });
}));

// Confirm OTP + set new password
router.post("/password-reset/confirm", validate(passwordResetConfirmSchema), asyncHandler(async (req, res) => {
  const { email, emp_no, otp, new_password } = req.body;

  const u = await findUserByEmailOrEmpNo({ email, emp_no });
  if (!u) throw httpError(404, "Invalid email/emp no");
  if (u.status !== "ACTIVE") throw httpError(403, "Account not active");

  const r = await query(
    `SELECT id, otp_hash, otp_salt, expires_at
     FROM password_reset_requests
     WHERE user_id=$1 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [u.id]
  );
  if (r.rowCount === 0) throw httpError(400, "No active OTP. Please request again.");

  const row = r.rows[0];
  const expires = DateTime.fromISO(row.expires_at, { zone: "utc" });
  if (DateTime.utc() > expires) throw httpError(400, "OTP expired. Please request again.");

  const computed = hashOtp(otp, row.otp_salt);
  if (computed !== row.otp_hash) throw httpError(400, "Invalid OTP");

  const newHash = await bcrypt.hash(new_password, 12);

  await query("UPDATE users SET previous_password_hash = password_hash, password_hash = $1 WHERE id = $2", [newHash, u.id]);
  await query("UPDATE password_reset_requests SET consumed_at = NOW() WHERE id = $1", [row.id]);

  res.json({ ok: true, message: "Password updated" });
}));

module.exports = router;
