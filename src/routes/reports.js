const express = require("express");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { query } = require("../db/pool");
const { buildRouteWisePdf, buildVehicleReportPdf } = require("../services/reportPdf");
const { buildDepartmentWiseExcel } = require("../services/reportExcel");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("ADMIN","HR","TA","PLANNING"));

async function ensureFinalApproved(requestId) {
  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [requestId]);
  if (r.rowCount === 0) throw httpError(404, "Request not found");
  if (r.rows[0].status !== "HR_FINAL_APPROVED") throw httpError(400, "Reports available only after HR final approval");
}

router.get("/route-wise", asyncHandler(async (req, res) => {
  const requestId = parseInt(req.query.request_id, 10);
  if (!requestId) throw httpError(400, "request_id required");
  await ensureFinalApproved(requestId);
  const pdf = await buildRouteWisePdf(requestId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="route-wise-${requestId}.pdf"`);
  res.send(pdf);
}));

router.get("/vehicle", asyncHandler(async (req, res) => {
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


// Daily Department-wise Excel report (planning department / after HR final approval)
router.get("/daily/department-excel", asyncHandler(async (req, res) => {
  const date = (req.query.date || "").trim();
  const offTime = (req.query.off_time || "").trim();
  const departmentId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;

  if (!date) throw httpError(400, "date required (YYYY-MM-DD)");

  const r = await query(
    "SELECT id FROM transport_requests WHERE request_date=$1 AND is_daily_master=TRUE",
    [date]
  );
  if (r.rowCount === 0) throw httpError(404, "Daily run not found for that date");

  const requestId = r.rows[0].id;
  await ensureFinalApproved(requestId);

  const xlsx = await buildDepartmentWiseExcel({ requestId, date, offTime, departmentId });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="department-wise-${date}.xlsx"`
  );
  res.send(xlsx);
}));


module.exports = router;
