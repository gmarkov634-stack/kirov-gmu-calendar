import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseForeignRWorkbookReviewed } from "../src/adapters/kgmu/foreign-r-reviewed.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCE_PAGE = "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya";
const SOURCE_URL = "https://kirovgma.ru/sites/default/files/files/2026/02/13/2037/2_lech._1_potok_fio-13-02-2026-10.xlsx";
const EXPECTED_GROUPS = ["201и", "202и", "203и", "204и", "205и", "206и", "207и", "208и"];
const PROBE_VERSION = 2;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      referer: SOURCE_PAGE,
      accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
      "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`KGMU source download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = await readKgmuXlsxStructure(buffer);
  const classification = classifyKgmuWorkbook(workbook);
  assert(classification.type === "R", `classification: expected R, got ${classification.type}`);

  const parsed = parseForeignRWorkbookReviewed(workbook, {
    university: "kgmu",
    program: "foreign",
    course: 2,
    academicYear: "2025/26",
    semester: 2,
  });

  const groups = (parsed.schedules || []).map((schedule) => schedule.group?.code).filter(Boolean);
  assert(JSON.stringify(groups) === JSON.stringify(EXPECTED_GROUPS), `groups: expected ${EXPECTED_GROUPS.join(",")}, got ${groups.join(",")}`);
  assert((parsed.qa?.sourceAnchorCount || 0) > 0, "sourceAnchorCount must be positive");
  assert((parsed.qa?.eventCount || 0) > 0, "eventCount must be positive");

  const summary = {
    status: "PROBED",
    probeVersion: PROBE_VERSION,
    source: SOURCE_URL,
    classification,
    groups,
    qaStatus: parsed.qa?.status,
    eventCount: parsed.qa?.eventCount,
    eventCountsByGroup: parsed.qa?.eventCountsByGroup,
    sourceAnchorCount: parsed.qa?.sourceAnchorCount,
    coveredSourceAnchors: parsed.qa?.coveredSourceAnchors,
    uncovered: parsed.qa?.uncovered || [],
    extraLessonFailures: parsed.qa?.extraLessonFailures || [],
    allowedOverlaps: parsed.qa?.allowedOverlaps || [],
    remainingOverlaps: parsed.qa?.remainingOverlaps || [],
    sourcePeriodExceptions: parsed.qa?.sourcePeriodExceptions || [],
    safetyFixups: parsed.qa?.safetyFixups || {},
  };
  console.log("R_FIO_COURSE2_PROBE=" + JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
