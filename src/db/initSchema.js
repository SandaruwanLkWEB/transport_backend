const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

async function ensureSchema() {
  const client = await pool.connect();
  try {
    // if any critical table missing, run schema
    const required = [
      "departments",
      "users",
      "routes",
      "transport_requests"
    ];

    for (const t of required) {
      const { rows } = await client.query(
        "SELECT to_regclass($1) AS t",
        [`public.${t}`]
      );
      if (!rows[0].t) {
        const schemaPath = path.join(__dirname, "schema.sql");
        const sql = fs.readFileSync(schemaPath, "utf8");
        await client.query(sql);
        return { created: true };
      }
    }

    return { created: false };
  } finally {
    client.release();
  }
}

module.exports = { ensureSchema };
