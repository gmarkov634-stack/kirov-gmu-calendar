import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCycleWorkbook } from "../src/adapters/kgmu/foreign-c-parser.mjs";
import { parseKgmuForeignCourse5Workbook } from "../src/adapters/kgmu/foreign-c-course5-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*-?\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}

function inspect(workbook) {
  const sheet = workbook.sheets?.[0];
  if (!sheet) return {};
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
    const n = Number(cell.value);
    return Number.isInteger(n) && n >= 1 && n <= 31;
  }).length >= 10)?.[0] || null;
  const groups = [];
  const groupRows = [];
  for (const [row, cells] of rows) {
    for (const cell of cells) {
      const group = groupCode(cell.value);
      if (group && !groups.includes(group)) {
        groups.push(group);
        groupRows.push({ row, group, cell: cell.ref });
      }
    }
  }
  const groupRowSet = new Set(groupRows.map((item) => item.row));
  const anchors = [];
  for (const cell of sheet.cells || []) {
    if (!groupRowSet.has(cell.row) || !clean(cell.value) || groupCode(cell.value)) continue;
    anchors.push({ row: cell.row, cell: cell.ref, text: clean(cell.value), styleId: cell.styleId ?? null, fillId: cell.fillId ?? null });
  }
  const footerHeader = [...rows.entries()].find(([, cells]) => cells.some((cell) => /^(?:дисциплина|academic\s+discipline)$/i.test(clean(cell.value))))?.[0] || null;
  const footer = footerHeader ? [...rows.entries()]
    .filter(([row]) => row >= footerHeader && row <= footerHeader + 25)
    .map(([row, cells]) => ({ row, values: cells.map((cell) => ({ cell: cell.ref, value: clean(cell.value) })).filter((item) => item.value) }))
    .filter((item) => item.values.length) : [];
  const notes = [...rows.entries()]
    .filter(([row]) => groupRows.length && row > Math.max(...groupRows.map((item) => item.row)) && (!footerHeader || row < footerHeader))
    .map(([row, cells]) => ({ row, values: cells.map((cell) => clean(cell.value)).filter(Boolean) }))
    .filter((item) => item.values.length);
  return {
    sheet: sheet.name,
    dateRow,
    groups,
    groupRows,
    anchors,
    footerHeader,
    footer,
    notes,
    mergeCount: (sheet.merges || []).length,
    styledCellCount: (sheet.styledCells || []).length,
  };
}

function attempt(label, fn) {
  try {
    const parsed = fn();
    return {
      label,
      ok: true,
      type: parsed.type,
      profile: parsed.profile,
      groups: parsed.schedules?.map((item) => item.group.code),
      qa: parsed.qa,
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
  const inspection = inspect(workbook);
  const metadata = {
    program: "foreign",
    course: 6,
    academicYear: "2025/26",
    semester: 2,
    sourceUrl: source.url,
  };
  return {
    source: { ...source, status: response.status, bytes: buffer.length, signature: buffer.subarray(0, 4).toString("hex") },
    classification,
    inspection,
    attempts: [
      attempt("course5-parser-as-course6", () => parseKgmuForeignCourse5Workbook(workbook, metadata)),
      attempt("course4-parser-as-course6", () => parseKgmuForeignCycleWorkbook(workbook, metadata)),
    ],
  };
}

async function main() {
  const results = [];
  for (const source of SOURCES) results.push(await probe(source));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
