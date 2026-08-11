import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuMixedWorkbook } from "../src/adapters/kgmu/mixed-s-parser.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCE_URL = "https://kirovgma.ru/sites/default/files/files/2026/05/07/1097/2_stomat-07-05-2026-15.xlsx";
const EXPECTED = {
  eventCount: 830,
  sourceBlocks: 62,
  coveredSourceBlocks: 62,
  duplicateCount: 0,
  overlapCount: 13,
  digest: "2144bbbef763a295688fd6781ffdd1908d33074fd9c9ba76216e0104eaebc44b",
  groupCounts: { "291": 208, "292": 208, "293": 207, "294": 207 },
};

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function canonicalRows(schedules) {
  const rows = [];
  for (const schedule of schedules) for (const event of schedule.events) {
    rows.push([String(schedule.group.code), event.title, event.start, event.end, event.location || "", event.assessment || ""]);
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "ru"));
}
function digest(rows) {
  return createHash("sha256").update(rows.map((row) => JSON.stringify(row)).join("\n")).digest("hex");
}

async function main() {
  const response = await fetch(SOURCE_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`KGMU source download failed: ${response.status}`);
  const workbook = await readKgmuXlsxStructure(Buffer.from(await response.arrayBuffer()));
  const classification = classifyKgmuWorkbook(workbook);
  equal(classification.type, "S", "classification");
  const parsed = parseKgmuMixedWorkbook(workbook, { program: "dentistry", course: 2, academicYear: "2025/26", semester: 2 });
  if (!parsed.qa.passed) console.error("MIXED_QA", JSON.stringify(parsed.qa, null, 2));
  equal(parsed.qa.passed, true, "qa.passed");
  equal(parsed.qa.eventCount, EXPECTED.eventCount, "qa.eventCount");
  equal(parsed.qa.sourceBlocks, EXPECTED.sourceBlocks, "qa.sourceBlocks");
  equal(parsed.qa.coveredSourceBlocks, EXPECTED.coveredSourceBlocks, "qa.coveredSourceBlocks");
  equal(parsed.qa.duplicateCount, EXPECTED.duplicateCount, "qa.duplicateCount");
  equal(parsed.qa.overlapCount, EXPECTED.overlapCount, "qa.overlapCount");
  for (const [group, count] of Object.entries(EXPECTED.groupCounts)) equal(parsed.qa.groupCounts[group], count, `group ${group}`);
  const rows = canonicalRows(parsed.schedules); equal(rows.length, EXPECTED.eventCount, "canonical event count");
  const actualDigest = digest(rows); equal(actualDigest, EXPECTED.digest, "canonical event digest");
  console.log(JSON.stringify({ status: "PASS", source: SOURCE_URL, classification: classification.type, qa: parsed.qa, digest: actualDigest }, null, 2));
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
