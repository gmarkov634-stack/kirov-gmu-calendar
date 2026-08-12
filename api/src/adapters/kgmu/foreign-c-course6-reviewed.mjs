import { parseKgmuForeignCourse6Workbook as parseRawCourse6 } from "./foreign-c-course6-parser.mjs";

function normalizeCell(cell) {
  if (typeof cell?.value !== "string") return cell;
  const value = cell.value
    .replace(/[’`´]/g, "'")
    .replace(/^Клин\.\s*иммунлогия и аллергология$/i, "Клиническая иммунология и аллергология");
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
