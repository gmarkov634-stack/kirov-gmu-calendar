import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse6Workbook } from "../src/adapters/kgmu/foreign-c-course6-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const execFileAsync = promisify(execFile);
const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

async function rowMetadata(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-c6-row-"));
  const filename = path.join(dir, "source.xlsx");
  try {
    await fs.writeFile(filename, buffer);
    const { stdout: xml } = await execFileAsync("unzip", ["-p", filename, "xl/worksheets/sheet1.xml"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const rows = [];
    for (const match of xml.matchAll(/<row\b([^>]*)r="(1[4-9])"([^>]*)>/g)) {
      const attrs = `${match[1]} r="${match[2]}" ${match[3]}`.replace(/\s+/g, " ").trim();
      rows.push({ row: Number(match[2]), hidden: /\bhidden="1"/.test(attrs), zeroHeight: /\bht="0(?:\.0+)?"/.test(attrs), attrs });
    }
    return rows;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function probe(source) {
  const response = await fetch(source.url, { headers: { "user-agent": UA, referer: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error(`${source.language} invalid XLSX`);
  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  const parsed = parseKgmuForeignCourse6Workbook(workbook, {
    program: "foreign",
    course: 6,
    academicYear: "2025/26",
    semester: 2,
    sourceUrl: source.url,
  });
  return {
    source: { ...source, bytes: buffer.length },
    groupRowMetadata: await rowMetadata(buffer),
    classification,
    parsed: {
      type: parsed.type,
      profile: parsed.profile,
      scheduleGroups: parsed.schedules.map((item) => item.group.code),
      qa: {
        status: parsed.qa.status,
        sourceLanguage: parsed.qa.sourceLanguage,
        sourceGroups: parsed.qa.sourceGroups,
        primaryGroups: parsed.qa.primaryGroups,
        deterministicMainGridEvents: parsed.qa.deterministicMainGridEvents,
        deterministicMainGridEventsByGroup: parsed.qa.deterministicMainGridEventsByGroup,
        subjectDayCounts: parsed.qa.subjectDayCounts,
        examInterruptions: parsed.qa.examInterruptions,
        oncologyAmbiguities: parsed.qa.ambiguousOncologyLongDays,
        electiveAmbiguities: parsed.qa.ambiguousElectiveAssignments,
        mirrorSemanticRisks: parsed.qa.mirrorSemanticRisks,
        unhandledBlocks: parsed.qa.unhandledBlocks,
        missingTimes: parsed.qa.missingTimes,
        duplicates: parsed.qa.duplicateCount,
        allowedOverlaps: parsed.qa.allowedOverlaps.length,
        remainingOverlaps: parsed.qa.remainingOverlaps.length,
        eventCount: parsed.qa.eventCount,
        groupCounts: parsed.qa.groupCounts,
      },
    },
  };
}

const results = [];
for (const source of SOURCES) results.push(await probe(source));
console.log(JSON.stringify(results, null, 2));
