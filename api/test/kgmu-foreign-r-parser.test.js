import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseForeignRWorkbookSafe } from "../src/adapters/kgmu/foreign-r-safe.mjs";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  const encoded = [1, 2, 3, 4]
    .map((index) => fs.readFileSync(path.join(here, "fixtures", `kgmu-foreign-course1-2025-26.part${index}.b64`), "utf8").trim())
    .join("");
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

test("official foreign-student course 1 XLSX structure is classified as R", () => {
  const result = classifyKgmuWorkbook(loadFixture());
  assert.equal(result.type, "R");
  assert.deepEqual(result.features.groupCodes, ["101и", "102и", "103и", "104и", "105и", "106и", "107и", "108и", "109и", "110и"]);
});

test("foreign R production schedule QA matches verified source", () => {
  const result = parseForeignRWorkbookSafe(loadFixture(), { program: "foreign", course: 1 });
  assert.equal(result.qa.status, "REVIEW_REQUIRED");
  assert.equal(result.qa.sourceAnchorCount, 184);
  assert.equal(result.qa.coveredSourceAnchors, 184);
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.eventCount, 2579);
  assert.equal(result.qa.sourceConflicts.length, 3);
  assert.deepEqual(result.qa.eventCountsByGroup, {
    "101и": 260, "102и": 255, "103и": 254, "104и": 260, "105и": 256,
    "106и": 263, "107и": 258, "108и": 248, "109и": 262, "110и": 263,
  });
  assert.deepEqual(result.qa.inferredWeekdayRows.filter((item) => [22, 29].includes(item.row)), [
    { row: 22, weekday: 2 },
    { row: 29, weekday: 3 },
  ]);
  assert.equal(result.qa.extraLessonFailures.length, 2);
  assert.deepEqual(result.qa.extraLessonFailures.map((item) => [item.group, item.subject, item.count, item.weekday]), [
    ["103и", "Физика, математика", 2, 1],
    ["103и", "Анатомия", 2, 1],
  ]);
  assert.equal(result.qa.outOfPeriodSources.length, 1);
  assert.equal(result.qa.outOfPeriodSources[0].group, "110и");
  assert.equal(result.qa.outOfPeriodSources[0].title, "Медицинская информатика");
  assert.deepEqual(result.qa.outOfPeriodSources[0].dates, ["2026-10-26"]);
});

test("foreign R parser preserves verified special-time semantics", () => {
  const result = parseForeignRWorkbookSafe(loadFixture(), { program: "foreign", course: 1 });
  const events = result.schedules.flatMap((schedule) => schedule.events);

  const curator = events.filter((event) => event.group === "110и" && event.title === "Час куратора" && event.sourceCell === "K15");
  assert.deepEqual(curator.map((event) => [event.start, event.end]), [
    ["2026-03-30T16:40:00+03:00", "2026-03-30T17:40:00+03:00"],
    ["2026-04-13T16:40:00+03:00", "2026-04-13T17:40:00+03:00"],
    ["2026-04-27T16:40:00+03:00", "2026-04-27T17:40:00+03:00"],
    ["2026-05-11T16:40:00+03:00", "2026-05-11T17:40:00+03:00"],
  ]);

  const autumnLatin = events.filter((event) => event.group === "104и" && event.sourceCell === "E13" && event.start >= "2026-09-01");
  assert.deepEqual(autumnLatin.map((event) => [event.start, event.end]), [
    ["2026-09-07T13:10:00+03:00", "2026-09-07T14:40:00+03:00"],
    ["2026-09-14T13:10:00+03:00", "2026-09-14T14:40:00+03:00"],
    ["2026-09-21T13:10:00+03:00", "2026-09-21T14:40:00+03:00"],
    ["2026-09-28T13:10:00+03:00", "2026-09-28T14:40:00+03:00"],
    ["2026-10-05T13:10:00+03:00", "2026-10-05T14:40:00+03:00"],
    ["2026-10-12T13:10:00+03:00", "2026-10-12T14:40:00+03:00"],
  ]);

  const corrected = events.find((event) => event.group === "104и" && event.sourceCell === "E48" && event.start === "2026-04-04T15:30:00+03:00");
  assert.equal(corrected?.end, "2026-04-04T17:55:00+03:00");
  assert.match(corrected?.note || "", /G08/);
});
