const ExcelJS = require("exceljs");

function safeSheetName(name, fallback = "Sheet") {
  // Excel sheet name rules: max 31 chars, no : \/ ? * [ ]
  const cleaned = String(name || "")
    .replace(/[:\\/\?\*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || fallback;
  return base.slice(0, 31);
}

function applyThinBorder(cell) {
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function setRowBorder(ws, rowNumber, fromCol, toCol) {
  for (let c = fromCol; c <= toCol; c++) {
    applyThinBorder(ws.getRow(rowNumber).getCell(c));
  }
}

async function buildDepartmentDailyExcel({ date, offTime, departments }) {
  // departments: [{ department_id, department_name, employees: [{ emp_no, emp_name }] }]
  const wb = new ExcelJS.Workbook();
  wb.creator = "Transport Management System";
  wb.created = new Date();

  for (const dep of departments) {
    const ws = wb.addWorksheet(safeSheetName(dep.department_name, `DEP_${dep.department_id}`));

    // Column widths similar to the provided sample.
    ws.getColumn(1).width = 28; // A
    ws.getColumn(2).width = 16; // B
    ws.getColumn(3).width = 16; // C
    ws.getColumn(4).width = 16; // D

    // Row 1 blank

    // Row 2: Department Name
    ws.getCell("A2").value = "Department Name";
    ws.mergeCells("B2:D2");
    ws.getCell("B2").value = dep.department_name;
    ws.getCell("B2").alignment = { horizontal: "center" };
    setRowBorder(ws, 2, 1, 4);

    // Row 3: Date
    ws.getCell("A3").value = "Date";
    ws.mergeCells("B3:D3");
    ws.getCell("B3").value = date;
    ws.getCell("B3").alignment = { horizontal: "center" };
    setRowBorder(ws, 3, 1, 4);

    // Row 4: Off Time
    ws.getCell("A4").value = "Off Time";
    ws.mergeCells("B4:D4");
    ws.getCell("B4").value = offTime || "";
    ws.getCell("B4").alignment = { horizontal: "center" };
    setRowBorder(ws, 4, 1, 4);

    // Row 5 blank

    // Row 6: Headers
    ws.getCell("A6").value = "Emp Name";
    ws.getCell("B6").value = "Emp No";
    setRowBorder(ws, 6, 1, 2);

    // Employee rows start at 7
    let r = 7;
    for (const e of dep.employees) {
      ws.getCell(`A${r}`).value = e.emp_name;
      ws.getCell(`B${r}`).value = e.emp_no;
      setRowBorder(ws, r, 1, 2);
      r++;
    }

    // If no employees, still show one bordered empty row (like a table)
    if (dep.employees.length === 0) {
      setRowBorder(ws, r, 1, 2);
      r++;
    }

    // Total row
    ws.getCell(`A${r}`).value = "Total";
    ws.getCell(`B${r}`).value = dep.employees.length;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).font = { bold: true };
    setRowBorder(ws, r, 1, 2);

    // Nice-to-have: freeze header area
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 6 }];
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildDepartmentDailyExcel };
