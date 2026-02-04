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
       sr.sub_name as main_sub_name,
       v.vehicle_no, v.registration_no, v.capacity,
       ra.driver_name, ra.driver_phone,
       ra.route_id, ra.sub_route_id
     FROM request_assignments ra
     JOIN vehicles v ON v.id = ra.vehicle_id
     LEFT JOIN routes r ON r.id = ra.route_id
     LEFT JOIN sub_routes sr ON sr.id = ra.sub_route_id
     WHERE ra.request_id = $1
     ORDER BY r.route_no NULLS LAST, sr.sub_name NULLS LAST, v.vehicle_no`,
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
    doc.moveDown(1.5);

    // Get passengers for this specific assignment
    const passengers = await query(
      `SELECT e.full_name, e.emp_no,
              sr2.sub_name as passenger_sub
       FROM transport_request_employees tre
       JOIN employees e ON e.id = tre.employee_id
       LEFT JOIN sub_routes sr2 ON sr2.id = tre.effective_sub_route_id
       WHERE tre.request_id = $1 
         AND tre.effective_route_id IS NOT DISTINCT FROM $2 
         AND tre.effective_sub_route_id IS NOT DISTINCT FROM $3
       ORDER BY sr2.sub_name NULLS LAST, e.full_name`,
      [requestId, assign.route_id, assign.sub_route_id]
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

    // Display each sub-location with passengers
    let subIndex = 1;
    const subLocations = Object.keys(bySubLocation);
    
    for (const subName of subLocations) {
      const names = bySubLocation[subName];
      
      // ======= SUB-LOCATION IN LARGE FONT (36pt), NUMBERED =======
      doc.font('Helvetica-Bold').fontSize(36);
      doc.text(`${subIndex} / ${subName}`, { align: 'left' });
      doc.moveDown(0.4);
      subIndex++;

      // ======= PASSENGER NAMES (26pt) =======
      doc.font('Helvetica').fontSize(26);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        
        // Check if we need a new page
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
          // Repeat header on new page
          doc.font('Helvetica-Bold').fontSize(16);
          doc.text(`${driverText} - ${vehicleText} (continued)`, { align: 'center' });
          doc.moveDown(1);
          doc.font('Helvetica').fontSize(26);
        }
        
        doc.text(`   ${name}`, { continued: false });
        doc.moveDown(0.2);
      }
      
      // Space between sub-locations
      if (subIndex <= subLocations.length) {
        doc.moveDown(0.8);
      }
    }

    // ======= FOOTER: Driver contact info =======
    const pageHeight = doc.page.height;
    const footerY = pageHeight - 50;
    doc.fontSize(10).font('Helvetica');
    doc.text(
      `Driver: ${assign.driver_name || 'N/A'} | Phone: ${assign.driver_phone || 'N/A'} | Capacity: ${assign.capacity || 'N/A'}`, 
      40, 
      footerY, 
      { align: 'center', width: doc.page.width - 80 }
    );
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

  for (let idx = 0; idx < groups.rows.length; idx++) {
    const g = groups.rows[idx];

    // Check if we need a new page for this route header (conservative estimate)
    if (doc.y > pageHeight - bottomMargin - 150) {
      doc.addPage();
    }

    // ======= ROUTE HEADER (22pt, bold, underlined) =======
    doc.font('Helvetica-Bold').fontSize(22);
    const title = g.route_no ? `${g.route_no} - ${g.route_name}` : "NO ROUTE";
    doc.text(title, { underline: true });
    doc.moveDown(0.3);

    // ======= SUB-ROUTE (18pt) =======
    if (g.sub_name) {
      doc.font('Helvetica').fontSize(18);
      doc.text(`Sub-route: ${g.sub_name}`);
      doc.moveDown(0.3);
    }

    // Passenger count
    doc.font('Helvetica').fontSize(14);
    doc.text(`Total Passengers: ${g.headcount}`, { continued: false });
    doc.moveDown(0.5);

    // Get passengers for this route
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

    // ======= PASSENGER NAMES (16pt) =======
    doc.font('Helvetica').fontSize(16);
    for (const p of people.rows) {
      // Check page space before each name
      if (doc.y > pageHeight - bottomMargin) {
        doc.addPage();
        doc.font('Helvetica').fontSize(16);
      }
      doc.text(`  • ${p.full_name}`, { continued: false });
    }

    doc.moveDown(0.8);

    // ======= ASSIGNED VEHICLES =======
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
      // Check space for vehicle section
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
      doc.text("  No vehicles assigned yet.", { align: 'left' });
    }

    // Add spacing before next route
    doc.moveDown(1.5);
  }

  return docToBuffer(doc);
}

module.exports = { buildRouteWisePdf, buildVehicleReportPdf };
