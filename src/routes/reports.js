const express = require("express");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const { query } = require("../db/pool");
const { buildRouteWisePdf, buildVehicleReportPdf } = require("../services/reportPdf");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("ADMIN","HR","TA"));

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

module.exports = router;
