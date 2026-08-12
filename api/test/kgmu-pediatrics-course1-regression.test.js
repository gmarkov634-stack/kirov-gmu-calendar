import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parsePediatricsRWorkbookReviewed } from "../src/adapters/kgmu/pediatrics-r-reviewed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  const parts = [1, 2, 3].map((part) => fs.readFileSync(
    path.join(here, "fixtures", `kgmu-pediatrics-course1-2025-26.structure.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

test("R-PED parser covers pediatrics course 1 source and fails closed on the official 05.06 overlap", () => {
  const workbook = loadFixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "R");
  assert.deepEqual(classification.features.groupCodes, ["131","132","133","134","135","136","137","138","139"]);

  const result = parsePediatricsRWorkbookReviewed(workbook, {
    program: "pediatrics",
    course: 1,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.qa.status, "REVIEW_REQUIRED", JSON.stringify(result.qa, null, 2));
  assert.equal(result.qa.uncovered.length, 0);
  assert.equal(result.qa.extraLessonFailures.length, 0);
  assert.equal(result.qa.remainingOverlaps.length, 1);
  assert.equal(result.qa.remainingOverlaps[0].group, "132");
  assert.equal(result.qa.remainingOverlaps[0].start1, "2026-06-05T10:55:00+03:00");
  assert.equal(result.qa.remainingOverlaps[0].end1, "2026-06-05T13:20:00+03:00");
  assert.equal(result.qa.remainingOverlaps[0].start2, "2026-06-05T11:00:00+03:00");
  assert.equal(result.qa.remainingOverlaps[0].end2, "2026-06-05T12:30:00+03:00");
  assert.equal(result.schedules.length, 9);

  const events = result.schedules.flatMap((schedule) => schedule.events);

  const bioethicsLecture = events.find((event) => (
    event.group === "131" &&
    event.title === "ЛЕКЦ. БИОЭТИКА" &&
    event.start === "2026-01-26T08:30:00+03:00"
  ));
  assert.equal(bioethicsLecture?.end, "2026-01-26T10:00:00+03:00");

  assert.ok(events.some((event) => (
    event.group === "136" &&
    event.title === "Психология и педагогика" &&
    event.start === "2026-05-05T14:20:00+03:00" &&
    event.end === "2026-05-05T16:45:00+03:00"
  )));

  assert.ok(events.some((event) => (
    event.group === "139" &&
    event.title === "Психология и педагогика" &&
    event.start === "2026-01-31T11:45:00+03:00"
  )), "last schedule row must not be dropped when there is no footer");

  for (const date of ["2026-05-27", "2026-06-03"]) {
    assert.ok(events.some((event) => (
      event.group === "135" &&
      event.title === "Латинский язык" &&
      event.start === `${date}T15:10:00+03:00` &&
      event.end === `${date}T16:40:00+03:00`
    )), `inline extra lesson ${date} must use its explicit time`);
  }

  assert.ok(events.some((event) => (
    event.group === "131" &&
    event.title === "ЗАЧЕТ С ОЦЕНКОЙ — ИСТОРИЯ РОССИИ" &&
    event.start === "2026-06-05T10:55:00+03:00" &&
    event.end === "2026-06-05T13:20:00+03:00"
  )), "assessment date with text before alternate time must keep the alternate time");

  const anatomyLecture = events.find((event) => (
    event.group === "134" &&
    event.title === "ЛЕКЦ. АНАТОМИЯ" &&
    event.start === "2026-02-05T08:30:00+03:00"
  ));
  assert.equal(anatomyLecture?.location, "3 корпус, аудитория 803, ул. Владимирская, 112");
});
