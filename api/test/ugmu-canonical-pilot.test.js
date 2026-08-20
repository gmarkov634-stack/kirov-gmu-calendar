import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeUgmuWeeklyPilot } from "../src/adapters/ugmu/canonical.mjs";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";

const RAW = {
  university: "ugmu",
  course: 1,
  stream: "1",
  academicYear: "2026/2027",
  semester: 1,
  group: { code: "ОЛД 101" },
  semesterPeriod: { start: "2026-09-01", end: "2027-01-10" },
  weekAnchors: { I: "2026-09-01", II: "2026-09-07" },
  sources: [{
    url: "https://usma.ru/wp-content/uploads/2026/08/1OLD.pdf",
    sha256: "a".repeat(64),
  }],
  sourceReview: { status: "semantic-reviewed-pilot", publicationAllowed: false },
  events: [
    {
      title: "Химия",
      sourceTitle: "Химия",
      start: "2026-09-01T08:50:00+05:00",
      end: "2026-09-01T10:20:00+05:00",
      location: "Онлайн",
      locationNote: "",
      department: "Общей химии",
      lessonType: "lecture",
      weekRule: "weekly",
    },
    {
      title: "Химия",
      sourceTitle: "Химия",
      start: "2026-09-01T13:50:00+05:00",
      end: "2026-09-01T15:20:00+05:00",
      location: "Декабристов, 32",
      locationNote: "",
      department: "Общей химии",
      lessonType: "class",
      weekRule: "weekly",
    },
    {
      title: "Химия",
      sourceTitle: "Химия",
      start: "2026-09-08T08:50:00+05:00",
      end: "2026-09-08T10:20:00+05:00",
      location: "Онлайн",
      locationNote: "",
      department: "Общей химии",
      lessonType: "lecture",
      weekRule: "weekly",
    },
  ],
};

test("UGMU OLD 101 raw pilot converts to canonical schedule-batch/v1", () => {
  const batch = canonicalizeUgmuWeeklyPilot(RAW);
  assert.equal(batch.schema_version, "1.0");
  assert.equal(batch.schedule.university_code, "ugmu");
  assert.equal(batch.schedule.semester, "autumn");
  assert.equal(batch.schedule.group, "ОЛД 101");
  assert.equal(batch.schedule.period.week1_start_date, "2026-09-01");
  assert.equal(batch.events.length, 3);
  assert.equal(batch.events[0].lesson.type.code, "lecture");
  assert.equal(batch.events[1].lesson.type.code, "other");
  assert.equal(batch.events[0].lesson.locations[0].raw, "Онлайн");
  assert.equal(batch.events[0].lesson.locations[0].address, null);
  assert.equal(batch.events[1].lesson.locations[0].address, "Декабристов, 32");

  const qa = validateScheduleBatch(batch);
  assert.equal(qa.publishable, true, JSON.stringify(qa.errors));
});

test("UGMU canonical pilot uses common postprocessing without service advertising", () => {
  const batch = canonicalizeUgmuWeeklyPilot(RAW);
  const processed = postprocessSchedule(batch, { includeServiceSignature: false });
  const qa = validatePostprocessedSchedule(processed);
  assert.equal(qa.publishable, true, JSON.stringify(qa.errors));

  const firstLecture = processed.events[0];
  assert.equal(firstLecture.calendar.title, "ЛЕКЦ. ХИМИЯ");
  assert.match(firstLecture.calendar.description, /Лекция · 1 из 2/);
  assert.match(firstLecture.calendar.description, /Учебная неделя · 1/);
  assert.match(firstLecture.calendar.description, /Следующее занятие по дисциплине: 8 сентября/);
  assert.doesNotMatch(firstLecture.calendar.description, /gmarkov634-stack\.github\.io/);

  const classEvent = processed.events[1];
  assert.equal(classEvent.calendar.title, "Химия");
  assert.match(classEvent.calendar.description, /Занятие · 1 из 1/);
  assert.match(classEvent.calendar.description, /Последнее занятие по дисциплине/);
});

test("UGMU canonical pilot remains fail-closed to OLD 101", () => {
  assert.throws(
    () => canonicalizeUgmuWeeklyPilot({ ...RAW, group: { code: "ОЛД 102" } }),
    /fail-closed to ОЛД 101/,
  );
});
