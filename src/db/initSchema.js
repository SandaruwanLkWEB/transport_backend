const fs = require("fs");
const path = require("path");
const { query } = require("./pool");

async function initSchema() {
  // If core table exists, assume schema already applied.
  const check = await query("SELECT to_regclass('public.departments') as t");
  if (check.rows[0] && check.rows[0].t) return;

  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await query(sql);
}

module.exports = { initSchema };
