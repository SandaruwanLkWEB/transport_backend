const ExcelJS = require("exceljs");
const { query } = require("../db/pool");
const { httpError } = require("../utils/httpError");

function sanitizeSheetName(name, used) {
  const invalid = /[\[\]\:\*\?\/\\]/g;
  let base = String(name || "Department").replace(invalid, " ").trim();
  if (!base) base = "Department";
  // Excel sheet name max length is 31
  base = base.slice(0, 31);

  let finalName = base;
  let i = 2;
  while (used.has(finalName)) {
    const suffix = ` (${i})`;
    finalName = (base.slice(0, 31 - suffix.length) + suffix);
    i += 1;
  }
  used.add(finalName);
  return finalName;
}

function thinBorder() {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function applyBorder(ws, fromRow, toRow, fromCol, toCol) {
  const b = thinBorder();
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      ws.getCell(r, c).border = b;
    }
  }
}

async function fetchDepartmentsAndEmployees(requestId, departmentId = null) {
  // Only departments that actually have employees in this daily master request
  const deptQuery = `
    SELECT DISTINCT d.id, d.name
    FROM transport_request_employees tre
    JOIN employees e ON e.id = tre.employee_id
    JOIN departments d ON d.id = e.department_id
    WHERE tre.request_id = $1
      ${departmentId ? "AND d.id = $2" : ""}
    ORDER BY d.name ASC
  `;
  const deptParams = departmentId ? [requestId, departmentId] : [requestId];
  const depts = await query(deptQuery, deptParams);

  if (depts.rowCount === 0) {
    throw httpError(404, "No department data found for that day");
  }

  const result = [];
  for (const d of depts.rows) {
    const emp = await query(
      `
      SELECT DISTINCT e.emp_no, e.full_name
      FROM transport_request_employees tre
      JOIN employees e ON e.id = tre.employee_id
      WHERE tre.request_id = $1 AND e.department_id = $2
      ORDER BY e.emp_no ASC
      `,
      [requestId, d.id]
    );
    result.push({
      id: d.id,
      name: d.name,
      employees: emp.rows.map((r) => ({
        emp_no: r.emp_no,
        full_name: r.full_name,
      })),
    });
  }
  return result;
}

async function buildDepartmentWiseExcel({ requestId, date, offTime = "", departmentId = null }) {
  const departments = await fetchDepartmentsAndEmployees(requestId, departmentId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Transport Request System";
  wb.created = new Date();

  const usedNames = new Set();

  for (const dept of departments) {
    const ws = wb.addWorksheet(sanitizeSheetName(dept.name, usedNames));

    // Columns (A-D, to allow merged B:D area like your sample)
    ws.columns = [
      { key: "colA", width: 18 },
      { key: "colB", width: 15 },
      { key: "colC", width: 15 },
      { key: "colD", width: 15 },
    ];

    // Template headers (similar to your sample.xlsx)
    ws.getCell("A2").value = "Department Name";
    ws.getCell("B2").value = dept.name;
    ws.mergeCells("B2:D2");

    ws.getCell("A3").value = "Date";
    ws.getCell("B3").value = date || "";
    ws.mergeCells("B3:D3");

    ws.getCell("A4").value = "Off Time";
    ws.getCell("B4").value = offTime || "";
    ws.mergeCells("B4:D4");

    ws.getCell("A5").value = "Emp Count";
    ws.getCell("B5").value = dept.employees.length;
    ws.mergeCells("B5:D5");

    // Table header
    ws.getCell("A6").value = "Emp Name";
    ws.getCell("B6").value = "Emp No";

    // Apply thin borders to header blocks
    applyBorder(ws, 2, 5, 1, 4);
    applyBorder(ws, 6, 6, 1, 2);

    // Data rows start at row 7
    let row = 7;
    for (const emp of dept.employees) {
      ws.getCell(row, 1).value = emp.full_name;
      ws.getCell(row, 2).value = emp.emp_no;
      applyBorder(ws, row, row, 1, 2);
      row += 1;
    }

    // Keep a little spacing (optional)
    ws.views = [{ state: "frozen", ySplit: 6 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { buildDepartmentWiseExcel };
