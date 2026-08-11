import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuCycleWorkbook } from "../src/adapters/kgmu/cycle-parser.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCE_URL = "https://kirovgma.ru/sites/default/files/files/2026/02/02/1078/4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx";
const EXPECTED = {
  eventCount: 2230,
  sourceBlocks: 220,
  coveredSourceBlocks: 220,
  duplicateCount: 0,
  overlapCount: 2,
  digest: "f2afeeff15c12502993f517dd6ef2b6b6f2c458b6c4d824e0fc1b92c56064a62",
  groupCounts: {
    "401":112,"402":112,"403":112,"404":112,"405":111,"406":111,"407":112,"408":112,"409":112,"410":112,
    "411":112,"412":112,"413":111,"414":111,"415":111,"416":111,"417":111,"418":111,"419":111,"420":111,
  },
};

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function canonicalRows(schedules) {
  const rows = [];
  for (const schedule of schedules) {
    const group = String(schedule.group.code);
    for (const event of schedule.events) {
      rows.push([
        group,
        event.title,
        event.start,
        event.end,
        event.location || "",
        event.assessment || "",
      ]);
    }
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "ru"));
}

function digestRows(rows) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  return createHash("sha256").update(body).digest("hex");
}

async function main() {
  const response = await fetch(SOURCE_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`KGMU source download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  assertEqual(classification.type, "C", "classification");

  const parsed = parseKgmuCycleWorkbook(workbook, {
    program: "medicine",
    course: 4,
    academicYear: "2025/26",
    semester: 2,
  });

  assertEqual(parsed.qa.passed, true, "qa.passed");
  assertEqual(parsed.qa.eventCount, EXPECTED.eventCount, "qa.eventCount");
  assertEqual(parsed.qa.sourceBlocks, EXPECTED.sourceBlocks, "qa.sourceBlocks");
  assertEqual(parsed.qa.coveredSourceBlocks, EXPECTED.coveredSourceBlocks, "qa.coveredSourceBlocks");
  assertEqual(parsed.qa.duplicateCount, EXPECTED.duplicateCount, "qa.duplicateCount");
  assertEqual(parsed.qa.overlapCount, EXPECTED.overlapCount, "qa.overlapCount");
  for (const [group, expected] of Object.entries(EXPECTED.groupCounts)) {
    assertEqual(parsed.qa.groupCounts[group], expected, `group ${group}`);
  }

  const rows = canonicalRows(parsed.schedules);
  assertEqual(rows.length, EXPECTED.eventCount, "canonical event count");
  const digest = digestRows(rows);
  assertEqual(digest, EXPECTED.digest, "canonical event digest");
  console.log(JSON.stringify({ status: "PASS", source: SOURCE_URL, classification: classification.type, qa: parsed.qa, digest }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
