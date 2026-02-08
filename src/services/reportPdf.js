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

/**
 * Vehicle Report: One route per page
 * - Driver name + Vehicle number: 16pt
 * - Sub-locations (villages): 36pt, numbered 1/2/3
 * - Passenger names: 26pt
 */
async function buildVehicleReportPdf(requestId) {
  const doc = new PDFDocument({ 
    size: "A4", 
    margin: 40,
    bufferPages: true
  });
  
  doc.info.Title = `${env.REPORT_TITLE || 'Transport'} - Vehicle Assignment Report`;

  // Get all route-vehicle assignments
  const assignments = await query(
    `SELECT 
       r.route_no, r.route_name,
       v.id as vehicle_id,
       v.vehicle_no, v.registration_no, v.capacity,
       ra.driver_name, ra.driver_phone, ra.instructions,
       ra.route_id
     FROM request_assignments ra
     JOIN vehicles v ON v.id = ra.vehicle_id
     LEFT JOIN routes r ON r.id = ra.route_id
     WHERE ra.request_id = $1
     ORDER BY r.route_no NULLS LAST, v.vehicle_no`,
    [requestId]
  );

  if (assignments.rowCount === 0) {
    doc.fontSize(16).text('No vehicle assignments found.', { align: 'center' });
    return docToBuffer(doc);
  }

  let isFirstPage = true;

  for (const assign of assignments.rows) {
    // New page for each route/vehicle assignment
    if (!isFirstPage) {
      doc.addPage();
    }
    isFirstPage = false;

    // ======= HEADER: DRIVER NAME + VEHICLE NUMBER (16pt) =======
    doc.font('Helvetica-Bold').fontSize(16);
    const driverText = assign.driver_name || 'Driver Not Assigned';
    const vehicleText = assign.vehicle_no + 
                       (assign.registration_no ? ` (${assign.registration_no})` : '');
    doc.text(`${driverText} - ${vehicleText}`, { align: 'center' });
    
    // Route info below driver
    doc.fontSize(12).font('Helvetica');
    const routeText = assign.route_no ? `${assign.route_no} - ${assign.route_name}` : 'No Route';
    doc.text(routeText, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Driver: ${assign.driver_name || 'N/A'}   |   Phone: ${assign.driver_phone || 'N/A'}   |   Capacity: ${assign.capacity || 'N/A'}`, { align: 'center' });
    doc.moveDown(1.2);

    // Get passengers for this specific vehicle (using assigned_vehicle_id)
    const passengers = await query(
      `SELECT e.full_name, e.emp_no,
              sr2.sub_name as passenger_sub
       FROM transport_request_employees tre
       JOIN employees e ON e.id = tre.employee_id
       LEFT JOIN sub_routes sr2 ON sr2.id = tre.effective_sub_route_id
       WHERE tre.request_id = $1 
         AND tre.assigned_vehicle_id = $2
       ORDER BY sr2.sub_name NULLS LAST, e.full_name`,
      [requestId, assign.vehicle_id]
    );

    if (passengers.rowCount === 0) {
      doc.fontSize(14).text('No passengers assigned to this route.', { align: 'center' });
      continue;
    }

    // Group passengers by sub-location (village)
    const bySubLocation = {};
    for (const p of passengers.rows) {
      const sub = p.passenger_sub || 'Main Route';
      if (!bySubLocation[sub]) bySubLocation[sub] = [];
      bySubLocation[sub].push(p.full_name);
    }

    // Display each sub-location with passengers (two-column layout)
    const pageW = doc.page.width;
    const leftX = 40;
    const colGap = 18;
    const colW = (pageW - 80 - colGap) / 2;
    const rightX = leftX + colW + colGap;
    const bottomY = doc.page.height - 60;

    let subIndex = 1;
    const subLocations = Object.keys(bySubLocation);

    const repeatHeader = (continued=false) => {
      doc.font('Helvetica-Bold').fontSize(16);
      doc.text(`${driverText} - ${vehicleText}${continued ? " (continued)" : ""}`, { align: 'center' });
      doc.fontSize(12).font('Helvetica');
      doc.text(routeText, { align: 'center' });
      // Driver + contact inline at top (NOT in footer)
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Driver: ${assign.driver_name || 'N/A'}   |   Phone: ${assign.driver_phone || 'N/A'}   |   Capacity: ${assign.capacity || 'N/A'}`, { align: 'center' });
      doc.moveDown(1);
    };

    for (const subName of subLocations) {
      const names = bySubLocation[subName];

      // Ensure room for sub heading
      if (doc.y > bottomY - 120) {
        doc.addPage();
        repeatHeader(true);
      }

      // ======= SUB-LOCATION (reduced but still large) =======
      doc.font('Helvetica-Bold').fontSize(28);
      doc.text(`${subIndex} / ${subName}`, { align: 'left' });
      doc.moveDown(0.3);
      subIndex++;

      // ======= PASSENGER NAMES (two columns) =======
      doc.font('Helvetica').fontSize(20);

      let x = leftX;
      let y = doc.y;
      const lineH = 26;

      for (let i = 0; i < names.length; i++) {
        const name = names[i];

        if (y > bottomY) {
          if (x === leftX) {
            // switch to right column
            x = rightX;
            y = doc.y;
          } else {
            // new page, reset columns + repeat header
            doc.addPage();
            repeatHeader(true);
            doc.font('Helvetica-Bold').fontSize(28);
            doc.text(`${subIndex-1} / ${subName} (cont.)`, { align: 'left' });
            doc.moveDown(0.2);
            doc.font('Helvetica').fontSize(20);
            x = leftX;
            y = doc.y;
          }
        }

        doc.text(`• ${name}`, x, y, { width: colW });
        y += lineH;
      }

      // move cursor to below the taller column
      doc.y = Math.max(y, doc.y) + 10;
      doc.moveDown(0.4);
    }

  }

  return docToBuffer(doc);
}

/**
 * Route-wise Report: All routes across pages with proper spacing
 * - Large readable fonts
 * - Proper page breaks
 * - Space-efficient layout
 */
async function buildRouteWisePdf(requestId) {
  const doc = new PDFDocument({ 
    size: "A4", 
    margin: 40 
  });
  
  doc.info.Title = `${env.REPORT_TITLE || 'Transport'} - Route-wise Report`;

  // Get all routes with passengers
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

  if (groups.rowCount === 0) {
    doc.fontSize(16).text('No routes found.', { align: 'center' });
    return docToBuffer(doc);
  }

  const pageHeight = doc.page.height;
  const bottomMargin = 70;

    let currentRouteKey = null;

  for (let idx = 0; idx < groups.rows.length; idx++) {
    const g = groups.rows[idx];

    const routeKey = g.route_id ? String(g.route_id) : "__NO_ROUTE__";
    const routeTitle = g.route_no ? `${g.route_no} - ${g.route_name}` : "NO ROUTE";

    // New route header only when route changes
    if (routeKey !== currentRouteKey) {
      currentRouteKey = routeKey;

      if (doc.y > pageHeight - bottomMargin - 150) {
        doc.addPage();
      }

      doc.font('Helvetica-Bold').fontSize(22);
      doc.text(routeTitle, { underline: true });
      doc.moveDown(0.4);
    }

    // ======= SUB-ROUTE (18pt) =======
    if (g.sub_name) {
      doc.font('Helvetica-Bold').fontSize(18);
      doc.text(`Sub-route: ${g.sub_name}`);
      doc.moveDown(0.2);
    } else {
      doc.font('Helvetica-Bold').fontSize(18);
      doc.text(`Sub-route: (not set)`);
      doc.moveDown(0.2);
    }

    // Passenger count
    doc.font('Helvetica').fontSize(14);
    doc.text(`Total Passengers: ${g.headcount}`);
    doc.moveDown(0.4);

    // Get passengers for this sub-route
    const people = await query(
      `SELECT e.full_name, e.emp_no
       FROM transport_request_employees tre
       JOIN employees e ON e.id = tre.employee_id
       WHERE tre.request_id=$1 
         AND tre.effective_route_id IS NOT DISTINCT FROM $2 
         AND tre.effective_sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY e.full_name`,
      [requestId, g.route_id, g.sub_route_id]
    );

    doc.font('Helvetica').fontSize(16);
    for (const p of people.rows) {
      if (doc.y > pageHeight - bottomMargin) {
        doc.addPage();
        // Repeat route header on a new page for readability
        doc.font('Helvetica-Bold').fontSize(22);
        doc.text(routeTitle, { underline: true });
        doc.moveDown(0.4);

        doc.font('Helvetica').fontSize(16);
      }
      doc.text(`  • ${p.full_name}`);
    }

    doc.moveDown(0.6);

    // ======= ASSIGNED VEHICLES (for this sub-route) =======
    const vehicles = await query(
      `SELECT v.vehicle_no, v.registration_no, v.capacity,
              ra.driver_name, ra.driver_phone
       FROM request_assignments ra
       JOIN vehicles v ON v.id=ra.vehicle_id
       WHERE ra.request_id=$1 
         AND ra.route_id IS NOT DISTINCT FROM $2 
         AND ra.sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY v.vehicle_no`,
      [requestId, g.route_id, g.sub_route_id]
    );

    if (vehicles.rowCount > 0) {
      if (doc.y > pageHeight - bottomMargin - 80) {
        doc.addPage();
      }

      doc.font('Helvetica-Bold').fontSize(14);
      doc.text("Assigned Vehicles:", { underline: true });
      doc.moveDown(0.2);

      doc.font('Helvetica').fontSize(12);
      for (const v of vehicles.rows) {
        const vehInfo = `${v.vehicle_no}${v.registration_no ? ' (' + v.registration_no + ')' : ''}`;
        const driverInfo = `${v.driver_name || 'N/A'} (${v.driver_phone || 'N/A'})`;
        doc.text(`  • ${vehInfo} - Driver: ${driverInfo} - Capacity: ${v.capacity || 'N/A'}`);
      }
    } else {
      doc.font('Helvetica-Oblique').fontSize(12);
      doc.text("  No vehicles assigned yet.");
    }

    doc.moveDown(1);
  }

  return docToBuffer(doc);
}

module.exports = { buildRouteWisePdf, buildVehicleReportPdf };
