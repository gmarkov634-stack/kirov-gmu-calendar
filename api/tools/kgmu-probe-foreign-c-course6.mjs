import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";
function clean(v) { return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function groupCode(v) { const m = clean(v).match(/^(\d{3})\s*-?\s*([иi])$/i); return m ? `${m[1]}и` : null; }
function rowsOf(sheet) { const rows = new Map(); for (const c of sheet.cells || []) { if (!rows.has(c.row)) rows.set(c.row, []); rows.get(c.row).push(c); } return rows; }
function effective(sheet, byRef, col, row) {
  let n = col, letters = ""; while (n > 0) { n -= 1; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
  const direct = byRef.get(`${letters}${row}`); if (direct) return direct.value;
  const merge = (sheet.merges || []).find((m) => m.startCol <= col && col <= m.endCol && m.startRow <= row && row <= m.endRow);
  return merge ? byRef.get(merge.startRef)?.value ?? "" : "";
}
function inspect(workbook) {
  const sheet = workbook.sheets[0], rows = rowsOf(sheet), byRef = new Map((sheet.cells || []).map((c) => [c.ref, c]));
  const groupRows = [];
  for (const [row, cs] of rows) { const hit = cs.find((c) => groupCode(c.value)); if (hit) groupRows.push({ row, group: groupCode(hit.value) }); }
  const groupRowSet = new Set(groupRows.map((x) => x.row));
  const grid = [...new Set((sheet.cells || []).filter((c) => groupRowSet.has(c.row) && !groupCode(c.value)).map((c) => clean(c.value)).filter(Boolean))].sort();
  let footerHeader = null, disciplineCol = null;
  for (const [row, cs] of rows) {
    const hit = cs.find((c) => /^(?:дисциплина|academic\s+discipline)$/i.test(clean(c.value)));
    if (hit) { footerHeader = row; disciplineCol = hit.col; break; }
  }
  const footer = [];
  if (footerHeader) {
    for (let row = footerHeader + 2; row <= Math.max(...rows.keys()); row += 1) {
      const discipline = clean(effective(sheet, byRef, disciplineCol, row));
      if (!discipline) continue;
      const times = (rows.get(row) || []).map((c) => clean(c.value)).filter((v) => /\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}/.test(v));
      footer.push({ row, discipline, times });
    }
  }
  return { sheet: sheet.name, groups: groupRows.map((x) => x.group), grid, footer };
}
async function probe(source) {
  const res = await fetch(source.url, { headers: { "user-agent": UA, referer: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya" } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("invalid XLSX");
  return { language: source.language, ...(inspect(await readKgmuXlsxStructure(buf))) };
}
const out = []; for (const source of SOURCES) out.push(await probe(source)); console.log(JSON.stringify(out, null, 2));
