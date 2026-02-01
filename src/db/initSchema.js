const fs = require("fs");
const path = require("path");
const { query } = require("./pool");

async function initSchema() {
  // Run idempotent schema/migrations on every boot.
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await query(sql);
}

module.exports = { initSchema };
