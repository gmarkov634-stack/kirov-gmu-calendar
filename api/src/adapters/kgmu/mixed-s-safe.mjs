import { parseKgmuMixedWorkbook } from "./mixed-s-parser.mjs";

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sourceSemesterRange(workbook) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return null;
  const preferred = (sheet.cells || []).find((cell) => /(?:перв|втор)\w*\s+полугод/i.test(clean(cell.value)) && /\d{1,2}\.\d{2}\.20\d{2}/.test(clean(cell.value)));
  const candidates = preferred ? [preferred, ...(sheet.cells || [])] : (sheet.cells || []);
  for (const cell of candidates) {
    const text = clean(cell.value);
    const match = text.match(/(\d{1,2}\.\d{2}\.20\d{2}).*?[-–]\s*(\d{1,2}\.\d{2}\.20\d{2})/);
    if (!match) continue;
    return { start: match[1], end: match[2], sourceCell: cell.ref };
  }
  return null;
}

function withSourcePeriodHint(workbook) {
  const range = sourceSemesterRange(workbook);
  if (!range) return { workbook, range: null };
  const sheets = [...(workbook?.sheets || [])];
  if (!sheets.length) return { workbook, range: null };
  const sheet = sheets[0];
  // mixed-s-parser resolves the first explicit full-year range in sheet cell order.
  // Prepending a derived hint from the authoritative semester header prevents an
  // academic-year fragment elsewhere in the sheet from selecting the wrong year.
  sheets[0] = {
    ...sheet,
    cells: [
      { ref: "A0", row: 0, col: 1, value: `${range.start} - ${range.end}`, derivedFrom: range.sourceCell },
      ...(sheet.cells || []),
    ],
  };
  return { workbook: { ...workbook, sheets }, range };
}

export function parseKgmuMixedWorkbookSafe(workbook, options = {}) {
  const prepared = withSourcePeriodHint(workbook);
  const result = parseKgmuMixedWorkbook(prepared.workbook, options);
  return {
    ...result,
    qa: {
      ...result.qa,
      sourceSemesterRange: prepared.range,
    },
  };
}
