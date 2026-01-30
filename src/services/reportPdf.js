const PDFDocument = require("pdfkit");
const { env } = require("../config/env");
const { query } = require("../db/pool");

function docToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

async function buildRouteWisePdf(requestId) {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  doc.info.Title = `${env.REPORT_TITLE} - Route Wise`;
  doc.fontSize(22);

  const groups = await query(
    `SELECT r.id as route_id, r.route_no, r.route_name,
            sr.id as sub_route_id, sr.sub_name,
            COUNT(*)::int as headcount
     FROM transport_request_employees tre
     LEFT JOIN routes r ON r.id = tre.effective_route_id
     LEFT JOIN sub_routes sr ON sr.id = tre.effective_sub_route_id
     WHERE tre.request_id=$1
     GROUP BY r.id, r.route_no, r.route_name, sr.id, sr.sub_name
     ORDER BY r.route_no NULLS LAST, sr.sub_name NULLS LAST`,
    [requestId]
  );

  for (let idx = 0; idx < groups.rows.length; idx++) {
    const g = groups.rows[idx];
    if (idx > 0) doc.addPage();

    const title = g.route_no ? `${g.route_no} - ${g.route_name}` : "NO ROUTE";
    doc.text(title, { underline: true });

    if (g.sub_name) {
      doc.moveDown(0.4);
      doc.text(`Sub: ${g.sub_name}`);
    }

    doc.moveDown(0.6);

    const people = await query(
      `SELECT e.full_name
       FROM transport_request_employees tre
       JOIN employees e ON e.id = tre.employee_id
       WHERE tre.request_id=$1 AND tre.effective_route_id IS NOT DISTINCT FROM $2 AND tre.effective_sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY e.full_name`,
      [requestId, g.route_id, g.sub_route_id]
    );

    doc.text(`Count: ${g.headcount}`);
    doc.moveDown(0.4);

    for (const p of people.rows) {
      doc.text(`• ${p.full_name}`);
    }

    doc.moveDown(0.6);

    const vehicles = await query(
      `SELECT v.vehicle_no, ra.driver_name, ra.driver_phone, ra.instructions
       FROM request_assignments ra
       JOIN vehicles v ON v.id=ra.vehicle_id
       WHERE ra.request_id=$1 AND ra.route_id IS NOT DISTINCT FROM $2 AND ra.sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY v.vehicle_no`,
      [requestId, g.route_id, g.sub_route_id]
    );

    if (vehicles.rowCount > 0) {
      doc.text("Vehicles / Driver:", { underline: true });
      doc.moveDown(0.3);
      for (const v of vehicles.rows) {
        doc.text(`• ${v.vehicle_no} | ${v.driver_name || ""} | ${v.driver_phone || ""}`);
        if (v.instructions) doc.text(`  Instructions: ${v.instructions}`);
      }
    } else {
      doc.text("Vehicles not assigned.");
    }
  }

  return docToBuffer(doc);
}

async function buildVehicleReportPdf(requestId) {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  doc.info.Title = `${env.REPORT_TITLE} - Vehicle Report`;
  doc.fontSize(22);

  const groups = await query(
    `SELECT r.route_no, r.route_name, sr.sub_name,
            e.full_name
     FROM transport_request_employees tre
     JOIN employees e ON e.id = tre.employee_id
     LEFT JOIN routes r ON r.id = tre.effective_route_id
     LEFT JOIN sub_routes sr ON sr.id = tre.effective_sub_route_id
     WHERE tre.request_id=$1
     ORDER BY r.route_no NULLS LAST, sr.sub_name NULLS LAST, e.full_name`,
    [requestId]
  );

  let currentKey = null;
  for (const row of groups.rows) {
    const key = `${row.route_no || "NO"}||${row.sub_name || ""}`;
    if (currentKey !== key) {
      if (currentKey !== null) doc.moveDown(0.8);
      currentKey = key;
      const title = row.route_no ? `${row.route_no} - ${row.route_name}` : "NO ROUTE";
      doc.text(title, { underline: true });
      if (row.sub_name) doc.text(`Sub: ${row.sub_name}`);
      doc.moveDown(0.3);
    }
    doc.text(`• ${row.full_name}`);
  }

  return docToBuffer(doc);
}

module.exports = { buildRouteWisePdf, buildVehicleReportPdf };
