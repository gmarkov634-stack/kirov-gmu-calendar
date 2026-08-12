import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse6Workbook } from "../src/adapters/kgmu/foreign-c-course6-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const EXPECTED_GROUPS = ["601и", "602и", "603и", "604и", "605и"];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

for (const source of SOURCES) {
  const response = await fetch(source.url, {
    headers: { "user-agent": UA, referer: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya" },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(response.ok, true, `${source.language}: download failed`);
  assert.equal(buffer[0], 0x50, `${source.language}: not an XLSX ZIP`);
  assert.equal(buffer[1], 0x4b, `${source.language}: not an XLSX ZIP`);

  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C", `${source.language}: classification`);
  assert.deepEqual(classification.features.groupCodes, EXPECTED_GROUPS, `${source.language}: visible group classification`);

  const parsed = parseKgmuForeignCourse6Workbook(workbook, {
    program: "foreign",
    course: 6,
    academicYear: "2025/26",
    semester: 2,
    sourceUrl: source.url,
  });
  assert.equal(parsed.qa.status, "PASS", `${source.language}: QA must pass`);
  assert.deepEqual(parsed.qa.sourceGroups, EXPECTED_GROUPS, `${source.language}: source groups`);
  assert.deepEqual(parsed.schedules.map((schedule) => schedule.group.code), EXPECTED_GROUPS, `${source.language}: schedules`);
  assert.equal(parsed.qa.ambiguousOncologyLongDays.length, 0, `${source.language}: oncology ambiguity`);
  assert.equal(parsed.qa.ambiguousElectiveAssignments.length, 0, `${source.language}: elective ambiguity`);
  assert.equal(parsed.qa.unresolvedConfirmedRules.length, 0, `${source.language}: confirmed-rule resolution`);
  assert.equal(parsed.qa.mirrorSemanticRisks.length, 0, `${source.language}: hidden rows must not create mirror risk`);
  assert.equal(parsed.qa.unhandledBlocks.length, 0, `${source.language}: unhandled blocks`);
  assert.equal(parsed.qa.missingTimes.length, 0, `${source.language}: missing times`);
  assert.equal(parsed.qa.duplicateCount, 0, `${source.language}: duplicates`);
  assert.equal(parsed.qa.remainingOverlaps.length, 0, `${source.language}: blocking overlaps`);

  console.log(JSON.stringify({
    language: source.language,
    bytes: buffer.length,
    hiddenRows: workbook.sheets.map((sheet) => sheet.hiddenRows || []),
    classificationGroups: classification.features.groupCodes,
    qa: {
      status: parsed.qa.status,
      deterministicMainGridEvents: parsed.qa.deterministicMainGridEvents,
      normalizedOncologyDays: parsed.qa.normalizedOncologyDays,
      normalizedOncologyLongDays: parsed.qa.normalizedOncologyLongDays,
      electiveAllDayEvents: parsed.qa.electiveAllDayEvents,
      examEvents: parsed.qa.examEvents,
      giaEvents: parsed.qa.giaEvents,
      eventCount: parsed.qa.eventCount,
      groupCounts: parsed.qa.groupCounts,
      allowedOverlaps: parsed.qa.allowedOverlaps.length,
    },
  }, null, 2));
}
