import test from "node:test";
import assert from "node:assert/strict";
import { semesterEndFromSchedule } from "../src/subscription-period.js";

test("canonical KGMU semester end uses official floating time in Moscow offset", () => {
  const schedule = {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      period: { end_date: "2026-12-28" },
    },
    events: [
      { timing: { date: "2026-12-20", end_time: "12:10", all_day: false } },
      { timing: { date: "2026-12-21", end_time: "15:30", all_day: false } },
    ],
  };
  assert.equal(semesterEndFromSchedule(schedule), "2026-12-21T12:30:00.000Z");
});

test("canonical semester end falls back to declared period end when events have no usable end", () => {
  const schedule = {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      period: { end_date: "2026-12-28" },
    },
    events: [{ timing: { date: "bad", end_time: null, all_day: false } }],
  };
  assert.equal(semesterEndFromSchedule(schedule), "2026-12-28T20:59:00.000Z");
});
