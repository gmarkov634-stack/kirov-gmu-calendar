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
    path.join(here, "fixtures", `kgmu-foreign-course2-stream2-2025-26.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

test("R-FIO parses independent course 2 stream 2 source without new hardcoded subjects", () => {
  const workbook = loadFixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "R");
  assert.deepEqual(classification.features.groupCodes, ["209и","210и","211и","212и","213и","214и","215и","216и"]);

  const result = parseForeignRWorkbookReviewed(workbook, { program: "foreign", course: 2, academicYear: "2025/26", semester: 2 });
  assert.equal(result.qa.status, "PASS");
  assert.equal(result.qa.sourceAnchorCount, 116);
  assert.equal(result.qa.coveredSourceAnchors, 116);
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.eventCount, 2061);
  assert.deepEqual(result.qa.eventCountsByGroup, {
    "209и":258,"210и":258,"211и":256,"212и":258,
    "213и":258,"214и":258,"215и":259,"216и":256,
  });
  assert.equal(result.qa.extraLessonExpectations.length, 11);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.deepEqual(result.qa.serviceRows, ["B40:I40"]);
  assert.deepEqual(result.qa.holidayDates, ["2026-02-23","2026-03-09","2026-05-01","2026-05-09","2026-06-12"]);
  assert.equal(result.qa.allowedOverlaps.length, 1);
  assert.equal(result.qa.remainingOverlaps.length, 0);
  assert.equal(result.qa.sourcePeriodExceptions.length, 0);

  const events = result.schedules.flatMap((schedule) => schedule.events);
  const chained = events.find((event) => event.group === "214и" && event.sourceCell === "G8" && event.start.startsWith("2026-02-02T11:00"));
  assert.equal(chained?.end, "2026-02-02T13:25:00+03:00");
  assert.ok(!events.some((event) => event.title === "ЛЕКЦ. ГИГИЕНА" && event.start.startsWith("2026-02-21T")));
  assert.ok(!events.some((event) => event.group === "216и" && event.title === "Нормальная физиология" && event.start.startsWith("2026-02-06T")));
  assert.ok(events.some((event) => event.title === "ЛЕКЦ. ТОПОГРАФИЧЕСКАЯ АНАТОМИЯ И ОПЕРАТИВНАЯ ХИРУРГИЯ"));
  assert.ok(events.some((event) => event.title === "ЛЕКЦ. МЕДИЦИНСКАЯ И БИОЛОГИЧЕСКАЯ ФИЗИКА"));
});
