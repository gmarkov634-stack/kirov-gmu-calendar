import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const PAGE_URL = "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya";
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

function clean(value) { return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function decode(value) { return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'"); }
function strip(value) { return decode(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }

async function main() {
  const page = await fetch(PAGE_URL, { headers: { "user-agent": UA, accept: "text/html,*/*" } });
  const html = await page.text();
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.xlsx(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: decode(m[1]), label: strip(m[2]) }));
  const source = links.find(({ label }) => /501\s*и\s*[-–]\s*506\s*и/i.test(label) && /(?:второе|2)\s+(?:полугодие|семестр)/i.test(label))
    || links.find(({ label }) => /501\s*и\s*[-–]\s*506\s*и/i.test(label));
  if (!source) throw new Error(`Russian 501и-506и link not found; labels=${JSON.stringify(links.map((x) => x.label))}`);
  const url = new URL(source.href, PAGE_URL).href;
  const response = await fetch(url, { headers: { "user-agent": UA, referer: PAGE_URL } });
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(JSON.stringify({ stage: "ru-download", label: source.label, url, status: response.status, bytes: buffer.length, signature: buffer.subarray(0,4).toString("hex") }, null, 2));
  if (!response.ok || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("Russian source is not a readable XLSX ZIP");
  const workbook = await readKgmuXlsxStructure(buffer);
  console.log(JSON.stringify({ stage: "ru-classification", classification: classifyKgmuWorkbook(workbook) }, null, 2));
  const sheet = workbook.sheets[0];
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const footerHeader = [...rows.entries()].find(([, cells]) => cells.some((cell) => /дисциплин/i.test(clean(cell.value)) && /наимен|academic/i.test(clean(cell.value))))?.[0]
    || [...rows.entries()].find(([, cells]) => cells.some((cell) => /^дисциплина$/i.test(clean(cell.value))))?.[0]
    || 22;
  const footer = [];
  for (let row = footerHeader; row <= footerHeader + 16; row += 1) {
    const values = (rows.get(row) || []).sort((a,b)=>a.col-b.col).map((cell) => ({ cell: cell.ref, value: clean(cell.value) })).filter((x)=>x.value);
    if (values.length) footer.push({ row, values });
  }
  const groupRows = [...rows.entries()].filter(([, cells]) => cells.some((cell) => /^50[1-6]\s*[иi]$/i.test(clean(cell.value))));
  const anchors = [];
  for (const [row, cells] of groupRows) {
    for (const cell of cells) {
      if (cell.col <= 2) continue;
      const text = clean(cell.value);
      if (!text || /^\d+$/.test(text) || /^экзамены?$/i.test(text)) continue;
      anchors.push({ row, cell: cell.ref, text });
    }
  }
  console.log(JSON.stringify({ stage: "ru-inspection", sheet: sheet.name, footerHeader, footer, distinctAnchors: [...new Map(anchors.map((x)=>[x.text,x])).values()] }, null, 2));
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
