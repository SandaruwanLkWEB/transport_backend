const fs = require("fs");
const path = require("path");
const { query } = require("./pool");

async function tableExists(table) {
  const r = await query("SELECT to_regclass($1) AS t", [`public.${table}`]);
  return Boolean(r.rows?.[0]?.t);
}

async function columnExists(table, column) {
  const r = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [table, column]
  );
  return r.rowCount > 0;
}

async function constraintExists(constraintName) {
  const r = await query(
    `SELECT 1
     FROM pg_constraint
     WHERE conname = $1
     LIMIT 1`,
    [constraintName]
  );
  return r.rowCount > 0;
}

async function ensureColumn(table, column, typeSql) {
  if (!(await tableExists(table))) return;
  if (await columnExists(table, column)) return;
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql};`);
}

async function ensureTable(table, createSql) {
  if (await tableExists(table)) return;
  await query(createSql);
}

async function ensureFK({ name, table, column, refTable, refColumn = "id", onDelete = "SET NULL" }) {
  if (await constraintExists(name)) return;
  // Only add FK if both tables exist and column exists.
  if (!(await tableExists(table))) return;
  if (!(await tableExists(refTable))) return;
  if (!(await columnExists(table, column))) return;

  await query(
    `ALTER TABLE ${table}
     ADD CONSTRAINT ${name}
     FOREIGN KEY (${column}) REFERENCES ${refTable}(${refColumn})
     ON DELETE ${onDelete};`
  );
}

async function ensureUserRoleEnum() {
  // Create enum only if missing. If it already exists, do nothing.
  await query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
         CREATE TYPE user_role AS ENUM ('ADMIN','HOD','TA','HR','EMP');
       END IF;
     END $$;`
  );
}

async function migrateSchema() {
  // Idempotent, safe migrations for existing databases.
  // This prevents "Server error" on HOD employee endpoints when new columns are introduced.

  // Some older DBs were created before the enum existed.
  try {
    await ensureUserRoleEnum();
  } catch (e) {
    // If enum creation fails for any reason, skip (existing DBs might already have it).
    console.warn("initSchema: user_role enum ensure skipped:", e.message);
  }

  // Employees default route/sub-route support (used by HOD add employee form)
  await ensureColumn("employees", "default_route_id", "INTEGER");
  await ensureColumn("employees", "default_sub_route_id", "INTEGER");

  // Vehicles extra identifiers (TA UI uses these)
  await ensureColumn("vehicles", "registration_no", "TEXT");
  await ensureColumn("vehicles", "fleet_no", "TEXT");

  // Vehicles can serve multiple routes (TA UI uses checkboxes)
  await ensureTable(
    "vehicle_routes",
    `CREATE TABLE vehicle_routes (
      id SERIAL PRIMARY KEY,
      vehicle_id INT NOT NULL,
      route_id INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_vehicle_routes_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT fk_vehicle_routes_route
        FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
      CONSTRAINT uq_vehicle_routes UNIQUE (vehicle_id, route_id)
    );`
  );

  // Request assignment advanced fields (TA overbook/notes)
  await ensureColumn("request_assignments", "instructions", "TEXT");
  await ensureColumn("request_assignments", "overbook_amount", "INT NOT NULL DEFAULT 0");
  await ensureColumn("request_assignments", "overbook_reason", "TEXT");
  await ensureColumn("request_assignments", "overbook_status", "TEXT NOT NULL DEFAULT 'NONE'");

  // FK constraints (only added if not already present)
  await ensureFK({
    name: "fk_emp_default_route",
    table: "employees",
    column: "default_route_id",
    refTable: "routes",
    onDelete: "SET NULL",
  });

  await ensureFK({
    name: "fk_emp_default_sub",
    table: "employees",
    column: "default_sub_route_id",
    refTable: "sub_routes",
    onDelete: "SET NULL",
  });
}

async function initSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Fresh DB bootstrap
  const hasDepartments = await tableExists("departments");
  if (!hasDepartments) {
    console.log("DB init: fresh schema bootstrap...");
    await query(schemaSql);
  }

  // Always run safe migrations (important for Railway where DB persists)
  console.log("DB init: running safe migrations...");
  await migrateSchema();
}

module.exports = initSchema;
