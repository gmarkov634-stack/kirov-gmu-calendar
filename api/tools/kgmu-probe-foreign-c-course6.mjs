import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse6Workbook } from "../src/adapters/kgmu/foreign-c-course6-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

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
