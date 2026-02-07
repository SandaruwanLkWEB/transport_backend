const express = require("express");
const { authRequired } = require("../middleware/auth");
const { httpError } = require("../utils/httpError");
const { query } = require("../db/pool");
const { buildRouteWisePdf, buildVehicleReportPdf } = require("../services/reportPdf");
const { buildDepartmentDailyExcel } = require("../services/reportExcel");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired);

async function ensureFinalApproved(requestId) {
  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [requestId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (r.rows[0].status !== "HR_FINAL_APPROVED") throw httpError(400, "Reports available only after HR final approval");
}

router.get("/route-wise", asyncHandler(async (req, res) => {
  // ADMIN/HR/TA only
  if (!req.user || !["ADMIN","HR","TA"].includes(req.user.role)) throw httpError(403, "Forbidden");
  const requestId = parseInt(req.query.request_id, 10);
  if (!requestId) throw httpError(400, "request_id required");
  await ensureFinalApproved(requestId);
  const pdf = await buildRouteWisePdf(requestId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="route-wise-${requestId}.pdf"`);
  res.send(pdf);
}));

router.get("/vehicle", asyncHandler(async (req, res) => {
  // ADMIN/HR/TA only
  if (!req.user || !["ADMIN","HR","TA"].includes(req.user.role)) throw httpError(403, "Forbidden");
  const requestId = parseInt(req.query.request_id, 10);
  if (!requestId) throw httpError(400, "request_id required");
  await ensureFinalApproved(requestId);
  const pdf = await buildVehicleReportPdf(requestId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="vehicle-report-${requestId}.pdf"`);
  res.send(pdf);
}));


// Daily (date-based) reports - no request_id needed
router.get("/daily/route-wise", asyncHandler(async (req, res) => {
  // ADMIN/HR/TA only
  if (!req.user || !["ADMIN","HR","TA"].includes(req.user.role)) throw httpError(403, "Forbidden");
  const date = (req.query.date || "").trim();
  if (!date) throw httpError(400, "date required (YYYY-MM-DD)");
  const r = await query("SELECT id FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE", [date]);
  if (r.rowCount === 0) throw httpError(404, "Daily run not found for that date");
  const requestId = r.rows[0].id;
  await ensureFinalApproved(requestId);
  const pdf = await buildRouteWisePdf(requestId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="route-wise-${date}.pdf"`);
  res.send(pdf);
}));

router.get("/daily/vehicle", asyncHandler(async (req, res) => {
  // ADMIN/HR/TA only
  if (!req.user || !["ADMIN","HR","TA"].includes(req.user.role)) throw httpError(403, "Forbidden");
  const date = (req.query.date || "").trim();
  if (!date) throw httpError(400, "date required (YYYY-MM-DD)");
  const r = await query("SELECT id FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE", [date]);
  if (r.rowCount === 0) throw httpError(404, "Daily run not found for that date");
  const requestId = r.rows[0].id;
  await ensureFinalApproved(requestId);
  const pdf = await buildVehicleReportPdf(requestId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="vehicle-${date}.pdf"`);
  res.send(pdf);
}));


// Department-wise daily excel (Planning Department report)
// Query params:
//   date=YYYY-MM-DD (required)
//   department_id=number (optional)
//   off_time=HH:MM (optional - printed only)
router.get("/daily/department-excel", asyncHandler(async (req, res) => {
  // Allowed: ADMIN, HR, PLANNING
  if (!req.user || !["ADMIN","HR","PLANNING"].includes(req.user.role)) throw httpError(403, "Forbidden");

  const date = (req.query.date || "").trim();
  const offTime = (req.query.off_time || "").trim();
  const requestedDepId = (req.query.department_id || "").toString().trim();

  if (!date) throw httpError(400, "date required (YYYY-MM-DD)");

  const master = await query(
    "SELECT id FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE",
    [date]
  );
  if (master.rowCount === 0) throw httpError(404, "Daily run not found for that date");
  const requestId = master.rows[0].id;

  await ensureFinalApproved(requestId);

  // Pull employees for that day (from daily master)
  const employees = await query(
    `SELECT e.emp_no, e.full_name AS emp_name, d.id AS department_id, d.name AS department_name
     FROM transport_request_employees tre
     JOIN employees e ON e.id = tre.employee_id
     JOIN departments d ON d.id = e.department_id
     WHERE tre.request_id = $1
     ORDER BY d.name ASC, e.full_name ASC, e.emp_no ASC`,
    [requestId]
  );

  // Group by department
  const depMap = new Map();
  for (const row of employees.rows) {
    if (requestedDepId && String(row.department_id) !== String(requestedDepId)) continue;
    if (!depMap.has(row.department_id)) {
      depMap.set(row.department_id, {
        department_id: row.department_id,
        department_name: row.department_name,
        employees: [],
      });
    }
    depMap.get(row.department_id).employees.push({
      emp_no: row.emp_no,
      emp_name: row.emp_name,
    });
  }

  // If department_id specified but no rows found, still create a sheet with that department name (if valid)
  if (requestedDepId && depMap.size === 0) {
    const dep = await query("SELECT id, name FROM departments WHERE id=$1", [parseInt(requestedDepId, 10)]);
    if (dep.rowCount === 0) throw httpError(404, "Department not found");
    depMap.set(dep.rows[0].id, {
      department_id: dep.rows[0].id,
      department_name: dep.rows[0].name,
      employees: [],
    });
  }

  const departments = Array.from(depMap.values());

  // If no department filter and no employees, return empty workbook with one sheet
  if (departments.length === 0) {
    departments.push({ department_id: 0, department_name: "No Data", employees: [] });
  }

  const buf = await buildDepartmentDailyExcel({ date, offTime, departments });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="department-wise-${date}.xlsx"`
  );
  res.send(Buffer.from(buf));
}));


module.exports = router;
