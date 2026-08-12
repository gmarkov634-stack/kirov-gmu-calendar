import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseMedicineCourse3RWorkbookReviewed } from "../src/adapters/kgmu/medicine-course3-r-reviewed.mjs";

function loadFixture() {
  const encoded = fs.readFileSync(new URL("./fixtures/kgmu-medicine-course3-stream2-2025-26.workbook.json.gz.b64", import.meta.url), "utf8").trim();
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

test("full previously unseen medicine course 3 stream 2 workbook is fully covered but remains fail-closed only on unresolved source ambiguities", () => {
  const result = parseMedicineCourse3RWorkbookReviewed(loadFixture(), {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.deepEqual(result.schedules.map((schedule) => schedule.group.code), ["311", "312", "313", "314", "315", "316", "317", "318", "319"]);
  assert.equal(result.qa.sourceAnchorCount, 107);
  assert.equal(result.qa.coveredSourceAnchors, 107);
  assert.deepEqual(result.qa.uncovered, []);
  assert.deepEqual(result.qa.normalizationFailures, []);
  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.equal(result.qa.eventCount, 1810);

  const titles = result.schedules.flatMap((schedule) => schedule.events.map((event) => event.title));
  for (const leaked of ["Философия", "Биология", "Правоведение", "История России", "История медицины", "Иностранный язык", "Медицинская информатика", "Безопасность жизнедеятельности", "Экономика", "Анатомия"]) {
    assert.ok(!titles.includes(leaked), `unexpected leaked/false subject: ${leaked}`);
  }

  assert.equal(result.qa.extraLessonFailures.length, 2);
  assert.ok(result.qa.extraLessonFailures.some((failure) => failure.group === "316" && Number(failure.count) === 2 && failure.actual === 0));
  assert.ok(result.qa.extraLessonFailures.some((failure) => failure.group === "314" && Number(failure.count) === 2 && failure.actual === 0));

  const group314 = result.schedules.find((schedule) => schedule.group.code === "314")?.events || [];
  assert.ok(group314.some((event) =>
    event.title === "Общая хирургия" &&
    event.start === "2026-05-25T13:30:00+03:00" &&
    event.end === "2026-05-25T15:00:00+03:00"
  ));
  assert.ok(group314.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start === "2026-05-11T13:30:00+03:00" &&
    event.end === "2026-05-11T16:40:00+03:00"
  ));
  assert.ok(!group314.some((event) =>
    event.title === "Лучевая диагностика и терапия" &&
    event.start.startsWith("2026-05-25T")
  ));

  assert.equal(result.qa.confirmedOverlaps?.length, 7);
  assert.deepEqual(result.qa.remainingOverlaps, []);
});
