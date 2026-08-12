import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseMedicineCourse3RWorkbookReviewed } from "../src/adapters/kgmu/medicine-course3-r-reviewed.mjs";

function loadFixture() {
  const encoded = fs.readFileSync(new URL("./fixtures/kgmu-medicine-course3-stream2-2025-26.workbook.json.gz.b64", import.meta.url), "utf8").trim();
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

test("full previously unseen medicine course 3 stream 2 workbook is fully covered but remains fail-closed on source ambiguities", () => {
  const result = parseMedicineCourse3RWorkbookReviewed(loadFixture(), {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  const summary = {
    status: result.qa.status,
    sourceAnchorCount: result.qa.sourceAnchorCount,
    coveredSourceAnchors: result.qa.coveredSourceAnchors,
    uncovered: result.qa.uncovered,
    normalizationFailures: result.qa.normalizationFailures,
    extraLessonFailures: result.qa.extraLessonFailures,
    overlapCount: result.qa.remainingOverlaps?.length || 0,
    eventCount: result.qa.eventCount,
    eventCountsByGroup: result.qa.eventCountsByGroup,
  };
  console.log("KGMU MED3 full unseen QA", JSON.stringify(summary));

  assert.deepEqual(result.schedules.map((schedule) => schedule.group.code), ["311", "312", "313", "314", "315", "316", "317", "318", "319"]);
  assert.equal(result.qa.sourceAnchorCount, 107);
  assert.equal(result.qa.coveredSourceAnchors, 107);
  assert.deepEqual(result.qa.uncovered, []);
  assert.deepEqual(result.qa.normalizationFailures, []);
  assert.equal(result.qa.status, "REVIEW_REQUIRED");

  const titles = result.schedules.flatMap((schedule) => schedule.events.map((event) => event.title));
  for (const leaked of ["Философия", "Биология", "Правоведение", "История России", "История медицины", "Иностранный язык", "Медицинская информатика", "Безопасность жизнедеятельности", "Экономика", "Анатомия"]) {
    assert.ok(!titles.includes(leaked), `unexpected leaked/false subject: ${leaked}`);
  }

  assert.ok(result.qa.extraLessonFailures.some((failure) => failure.group === "316" && Number(failure.count) === 2 && failure.actual === 0));
  assert.ok(result.qa.extraLessonFailures.some((failure) => failure.group === "314" && Number(failure.count) === 2 && failure.actual === 0));
  assert.ok((result.qa.remainingOverlaps?.length || 0) > 0);
});
