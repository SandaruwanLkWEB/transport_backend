/**
 * Bootstrap initial system users (ADMIN/HOD/HR/TA).
 * Usage (after setting env in Railway/local):
 *   node src/db/bootstrap.js
 *
 * Env vars (required):
 *   ADMIN_EMAIL, ADMIN_PASSWORD
 * Optional:
 *   HR_EMAIL, HR_PASSWORD
 *   TA_EMAIL, TA_PASSWORD
 *   HOD_EMAIL, HOD_PASSWORD, HOD_DEPARTMENT_ID
 */
const bcrypt = require("bcryptjs");
const { query, pool } = require("./pool");

async function upsertUser({ email, password, role, status="ACTIVE", department_id=null }) {
  const hash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO users (email, password_hash, role, status, department_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, status=EXCLUDED.status, department_id=EXCLUDED.department_id`,
    [email, hash, role, status, department_id]
  );
}

async function main() {
  const {
    ADMIN_EMAIL, ADMIN_PASSWORD,
    HR_EMAIL, HR_PASSWORD,
    TA_EMAIL, TA_PASSWORD,
    HOD_EMAIL, HOD_PASSWORD, HOD_DEPARTMENT_ID
  } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for bootstrap.");
  }

  await upsertUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: "ADMIN" });

  if (HR_EMAIL && HR_PASSWORD) await upsertUser({ email: HR_EMAIL, password: HR_PASSWORD, role: "HR" });
  if (TA_EMAIL && TA_PASSWORD) await upsertUser({ email: TA_EMAIL, password: TA_PASSWORD, role: "TA" });
  if (HOD_EMAIL && HOD_PASSWORD && HOD_DEPARTMENT_ID) {
    await upsertUser({ email: HOD_EMAIL, password: HOD_PASSWORD, role: "HOD", department_id: parseInt(HOD_DEPARTMENT_ID, 10) });
  }

  console.log("Bootstrap complete.");
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
