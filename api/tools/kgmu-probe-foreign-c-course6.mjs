import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCycleWorkbook } from "../src/adapters/kgmu/foreign-c-parser.mjs";
import { parseKgmuForeignCourse5Workbook } from "../src/adapters/kgmu/foreign-c-course5-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

function clean(value) { return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*-?\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}
function rowsOf(sheet) {
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  return rows;
}
function compactInspection(workbook) {
  const sheet = workbook.sheets?.[0];
  const rows = rowsOf(sheet);
  const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
    const n = Number(cell.value);
    return Number.isInteger(n) && n >= 1 && n <= 31;
  }).length >= 10)?.[0] || null;
  const groupRows = [];
  for (const [row, cells] of rows) {
    const hit = cells.map((cell) => ({ cell, group: groupCode(cell.value) })).find((item) => item.group);
    if (hit) groupRows.push({ row, group: hit.group, cell: hit.cell.ref });
  }
  const groupRowSet = new Set(groupRows.map((item) => item.row));
  const uniqueAnchors = [...new Set((sheet.cells || [])
    .filter((cell) => groupRowSet.has(cell.row) && !groupCode(cell.value))
    .map((cell) => clean(cell.value)).filter(Boolean))].sort();
  const footerHeader = [...rows.entries()].find(([, cells]) => cells.some((cell) => /^(?:дисциплина|academic\s+discipline)$/i.test(clean(cell.value))))?.[0] || null;
  const footerRows = [];
  if (footerHeader) {
    for (let row = footerHeader + 2; row <= footerHeader + 25; row += 1) {
      const values = (rows.get(row) || []).map((cell) => ({ ref: cell.ref, col: cell.col, value: clean(cell.value) })).filter((item) => item.value);
      if (!values.length) continue;
      const discipline = values.find((item) => item.col >= 3 && item.col < 20)?.value || null;
      if (!discipline || /лекц|lecture/i.test(discipline)) continue;
      footerRows.push({ row, values: values.map((item) => `${item.ref}=${item.value}`) });
    }
  }
  const maxGroupRow = Math.max(...groupRows.map((item) => item.row));
  const notes = [...rows.entries()]
    .filter(([row]) => row > maxGroupRow && (!footerHeader || row < footerHeader))
    .flatMap(([row, cells]) => cells.map((cell) => ({ row, ref: cell.ref, value: clean(cell.value) })))
    .filter((item) => item.value);
  return { sheet: sheet.name, dateRow, groupRows, uniqueAnchors, footerHeader, footerRows, notes, mergeCount: (sheet.merges || []).length, styledCellCount: (sheet.styledCells || []).length };
}
function compactAttempt(label, fn) {
  try {
    const parsed = fn();
    return {
      label, ok: true, type: parsed.type, profile: parsed.profile,
      groups: parsed.schedules?.map((item) => item.group.code),
      qa: {
        status: parsed.qa?.status,
        eventCount: parsed.qa?.eventCount,
        groupCounts: parsed.qa?.groupCounts,
        mainGridSubjectDays: parsed.qa?.mainGridSubjectDays,
        physicalEducationEvents: parsed.qa?.physicalEducationEvents,
        starApplications: parsed.qa?.starApplications?.length,
        unhandledCount: parsed.qa?.unhandledBlocks?.length,
        unhandled: parsed.qa?.unhandledBlocks?.slice(0, 30),
        missingTimesCount: parsed.qa?.missingTimes?.length,
        missingTimes: parsed.qa?.missingTimes?.slice(0, 20),
        allowedOverlaps: parsed.qa?.allowedOverlaps?.length,
        remainingOverlaps: parsed.qa?.remainingOverlaps?.length,
      },
    };
  } catch (error) {
    return { label, ok: false, code: error?.code || null, message: error?.message || String(error) };
  }
}
async function probe(source) {
  const response = await fetch(source.url, { headers: { "user-agent": UA, referer: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error(`${source.language} source is not XLSX: HTTP ${response.status}`);
  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  const metadata = { program: "foreign", course: 6, academicYear: "2025/26", semester: 2, sourceUrl: source.url };
  return {
    source: { ...source, status: response.status, bytes: buffer.length, signature: buffer.subarray(0, 4).toString("hex") },
    classification,
    inspection: compactInspection(workbook),
    attempts: [
      compactAttempt("course5-parser", () => parseKgmuForeignCourse5Workbook(workbook, metadata)),
      compactAttempt("course4-parser", () => parseKgmuForeignCycleWorkbook(workbook, metadata)),
    ],
  };
}

const results = [];
for (const source of SOURCES) results.push(await probe(source));
console.log(JSON.stringify(results, null, 2));
