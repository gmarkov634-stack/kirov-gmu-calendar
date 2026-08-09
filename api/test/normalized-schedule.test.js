import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNormalizedSchedule,
  buildGroupId,
  validateNormalizedSchedule,
} from "../src/import/normalized-schedule.js";

function sample(overrides = {}) {
  return {
    version: 1,
    university: "omgmu",
    program: "medicine",
    course: 4,
    stream: "1",
    academicYear: "2026-2027",
    semester: 1,
    timezone: "Asia/Omsk",
    group: {
      id: "omgmu:medicine:4:stream-1:401",
      code: "401",
      displayName: "Группа 401",
    },
    sources: [{ url: "https://example.test/schedule.pdf", part: "cycles" }],
    events: [{
      id: "lesson-1",
      title: "Терапия",
      start: "2026-09-01T08:00:00+06:00",
      end: "2026-09-01T09:30:00+06:00",
      location: "Учебный корпус",
    }],
    ...overrides,
  };
}

test("buildGroupId supports streams and arbitrary group codes", () => {
  assert.equal(buildGroupId({
    university: "omgmu",
    program: "medicine-international",
    course: 2,
    stream: "1",
    groupCode: "2A-03",
  }), "omgmu:medicine-international:2:stream-1:2A-03");
});

test("valid normalized schedule is accepted", () => {
  const schedule = sample();
  assert.equal(assertNormalizedSchedule(schedule), schedule);
  assert.deepEqual(validateNormalizedSchedule(schedule), []);
});

test("contract is university-neutral", () => {
  const schedule = sample({
    university: "pgmu",
    program: "pediatrics",
    stream: null,
    timezone: "Asia/Yekaterinburg",
    group: {
      id: "pgmu:pediatrics:4:П-41",
      code: "П-41",
      displayName: "Группа П-41",
    },
  });
  assert.deepEqual(validateNormalizedSchedule(schedule), []);
});

test("invalid schedule reports structural errors", () => {
  const errors = validateNormalizedSchedule(sample({ university: "", events: null }));
  assert.ok(errors.includes("university is invalid"));
  assert.ok(errors.includes("events must be an array"));
});
