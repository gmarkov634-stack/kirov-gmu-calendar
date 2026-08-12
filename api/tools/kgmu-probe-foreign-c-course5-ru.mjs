import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse5Workbook } from "../src/adapters/kgmu/foreign-c-course5-parser.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const PAGE_URL = "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya";
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

function decode(value) {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function strip(value) {
  return decode(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function main() {
  const page = await fetch(PAGE_URL, { headers: { "user-agent": UA, accept: "text/html,*/*" } });
  if (!page.ok) throw new Error(`FIO page HTTP ${page.status}`);
  const html = await page.text();
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.xlsx(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: decode(match[1]), label: strip(match[2]) }));
  const source = links.find(({ label }) => /501\s*и\s*[-–]\s*506\s*и/i.test(label) && /(?:второе|2)\s+(?:полугодие|семестр)/i.test(label))
    || links.find(({ label }) => /501\s*и\s*[-–]\s*506\s*и/i.test(label));
  if (!source) throw new Error("Russian 501и-506и XLSX link was not found");

  const url = new URL(source.href, PAGE_URL).href;
  const response = await fetch(url, { headers: { "user-agent": UA, referer: PAGE_URL } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error(`Russian source is not XLSX: HTTP ${response.status}`);

  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  if (classification.type !== "C") throw new Error(`Expected C, got ${classification.type}`);

  const parsed = parseKgmuForeignCourse5Workbook(workbook, {
    program: "foreign",
    course: 5,
    academicYear: "2025/26",
    semester: 2,
    sourceUrl: url,
  });
  console.log(JSON.stringify({
    source: { label: source.label, url, bytes: buffer.length },
    classification,
    groups: parsed.schedules.map((schedule) => schedule.group.code),
    qa: parsed.qa,
  }, null, 2));

  if (!parsed.qa.passed) throw new Error(`Russian course 5 C-FIO QA=${parsed.qa.status}`);
  if (parsed.qa.sourceLanguage !== "ru") throw new Error(`Expected Russian source, got ${parsed.qa.sourceLanguage}`);
  if (parsed.qa.starApplications.length !== 5) throw new Error(`Expected 5 starred first-shift applications, got ${parsed.qa.starApplications.length}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
