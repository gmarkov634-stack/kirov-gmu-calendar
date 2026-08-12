import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseForeignRWorkbookReviewed } from "../src/adapters/kgmu/foreign-r-reviewed.mjs";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function loadFixture() {
  const parts = [1, 2, 3].map((part) => fs.readFileSync(
    path.join(here, "fixtures", `kgmu-foreign-course3-2025-26.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

test("R-FIO course 3 expands service-week cutoffs and stays fail-closed on elective ambiguity", () => {
  const workbook = loadFixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "R");
  assert.deepEqual(classification.features.groupCodes, ["301и","302и","303и","304и","305и","306и"]);

  const result = parseForeignRWorkbookReviewed(workbook, { program: "foreign", course: 3, academicYear: "2025/26", semester: 2 });
  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.equal(result.qa.sourceAnchorCount, 67);
  assert.equal(result.qa.coveredSourceAnchors, 66);
  assert.equal(result.qa.eventCount, 1166);
  assert.deepEqual(result.qa.eventCountsByGroup, {
    "301и":195,"302и":194,"303и":196,"304и":193,"305и":194,"306и":194,
  });
  assert.equal(result.qa.extraLessonExpectations.length, 18);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.equal(result.qa.allowedOverlaps.length, 1);
  assert.equal(result.qa.remainingOverlaps.length, 0);
  assert.equal(result.qa.sourcePeriodExceptions.length, 1);
  assert.deepEqual(result.qa.sourcePeriodExceptions[0].dates, ["2026-05-28"]);
  assert.deepEqual(result.qa.ambiguousLectureTimeCounts.map((item) => item.source), ["B16:G16"]);
  assert.deepEqual(result.qa.choiceDisciplineAmbiguities.map((item) => item.source).sort(), ["B15:G15", "B20:G20"]);
  assert.ok(result.qa.uncovered.some((item) => item.source === "B20:G20"));

  const events = result.schedules.flatMap((schedule) => schedule.events);
  const radiologyMonday = events.filter((event) => event.group === "305и" && event.sourceCell === "F8" && event.dateMode === "week-pattern");
  assert.deepEqual(radiologyMonday.map((event) => event.start.slice(0, 10)), [
    "2026-02-09","2026-03-23","2026-04-06","2026-04-20","2026-05-04","2026-05-18",
  ]);
  assert.ok(events.some((event) => event.group === "305и" && event.sourceCell === "F8" && event.start === "2026-05-15T08:00:00+03:00" && event.end === "2026-05-15T11:10:00+03:00"));
  assert.ok(result.qa.extraLessonExpectations.some((item) => item.group === "305и" && item.sourceCell === "F8" && item.count === 1 && item.weekday === 5));

  for (const group of ["301и","302и","303и","304и","305и","306и"]) {
    assert.ok(events.some((event) => event.group === group && event.sourceCell === "B25" && event.start === "2026-02-27T08:00:00+03:00" && event.end === "2026-02-27T09:30:00+03:00"));
    assert.ok(events.some((event) => event.group === group && event.sourceCell === "B25" && event.start === "2026-03-06T08:00:00+03:00" && event.end === "2026-03-06T09:30:00+03:00"));
    assert.ok(!events.some((event) => event.group === group && event.sourceCell === "B26" && event.title === "ЛЕКЦ. ОБЩАЯ ХИРУРГИЯ" && ["2026-02-27","2026-03-06"].includes(event.start.slice(0, 10))));
  }
  assert.ok(events.some((event) => event.group === "302и" && event.sourceCell === "C21" && event.start.startsWith("2026-05-28T") && event.title === "Лучевая диагностика и терапия"));

  const iok0302 = events.find((event) => event.group === "301и" && event.sourceCell === "B13" && event.start.startsWith("2026-02-03T"));
  const iok1702 = events.find((event) => event.group === "301и" && event.sourceCell === "B13" && event.start.startsWith("2026-02-17T"));
  const radiation3103 = events.find((event) => event.group === "301и" && event.sourceCell === "B13" && event.start.startsWith("2026-03-31T"));
  assert.equal(iok0302?.location, "1 корпус, аудитория 406, ул. Владимирская, 137");
  assert.equal(iok1702?.location, "1 корпус, аудитория 106, ул. Владимирская, 137");
  assert.equal(radiation3103?.location, "1 корпус, аудитория 406, ул. Владимирская, 137");
  assert.deepEqual([...new Set(events.filter((event) => event.sourceCell === "B15").map((event) => event.location))], [""]);
});
