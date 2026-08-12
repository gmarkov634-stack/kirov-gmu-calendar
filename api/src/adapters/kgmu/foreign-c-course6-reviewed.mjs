import { parseKgmuForeignCourse6Workbook as parseRawCourse6 } from "./foreign-c-course6-parser.mjs";

function normalizeCell(cell) {
  if (typeof cell?.value !== "string") return cell;
  let value = cell.value.replace(/[’`´]/g, "'");
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^Клин\./i.test(compact) && /иммун/i.test(compact) && /аллерголог/i.test(compact)) {
    value = "Клиническая иммунология и аллергология";
  }
  return value === cell.value ? cell : { ...cell, value };
}

function normalizedWorkbook(workbook) {
  return {
    ...workbook,
    sheets: (workbook?.sheets || []).map((sheet) => ({
      ...sheet,
      cells: (sheet.cells || []).map(normalizeCell),
      styledCells: (sheet.styledCells || []).map(normalizeCell),
    })),
  };
}

export function parseKgmuForeignCourse6Workbook(workbook, metadata = {}) {
  return parseRawCourse6(normalizedWorkbook(workbook), metadata);
}
