import { parseKgmuForeignCourse6Workbook as parseRawCourse6 } from "./foreign-c-course6-parser.mjs";
import { applyConfirmedCourse6Rules } from "./foreign-c-course6-confirmed.mjs";
import { applySharedGiaRule } from "./foreign-c-course6-shared-gia.mjs";

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
    sheets: (workbook?.sheets || []).map((sheet) => {
      const hidden = new Set((sheet.hiddenRows || []).map(Number));
      return {
        ...sheet,
        cells: (sheet.cells || []).filter((cell) => !hidden.has(Number(cell.row))).map(normalizeCell),
        styledCells: (sheet.styledCells || []).filter((cell) => !hidden.has(Number(cell.row))).map(normalizeCell),
        merges: (sheet.merges || []).filter((merge) => !hidden.has(Number(merge.startRow))),
      };
    }),
  };
}

export function parseKgmuForeignCourse6Workbook(workbook, metadata = {}) {
  const normalized = normalizedWorkbook(workbook);
  const parsed = parseRawCourse6(normalized, metadata);
  const confirmed = applyConfirmedCourse6Rules(normalized, parsed);
  return applySharedGiaRule(normalized, confirmed);
}
