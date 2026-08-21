import test from "node:test";
import assert from "node:assert/strict";

import { trialWindowFromSchedule } from "../src/trial-projection.js";

function schedule(dates) {
  return {
    timezone: "Asia/Yekaterinburg",
    events: dates.map((date, index) => ({
      id: `event-${index + 1}`,
      start: `${date}T09:00:00+05:00`,
      end: `${date}T10:30:00+05:00`,
    })),
  };
}

test("trial activated before semester starts from first schedule date", () => {
  const value = trialWindowFromSchedule(schedule(["2026-09-01", "2026-09-03", "2026-09-08"]), {
    activationAt: new Date("2026-08-21T12:00:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialStartDate, "2026-09-01");
  assert.equal(value.trialEndDateExclusive, "2026-09-08");
  assert.equal(value.scheduleEventCount, 2);
  assert.equal(value.trialWindowClosed, undefined);
});

test("trial activated mid-semester starts from local activation date for seven calendar days", () => {
  const value = trialWindowFromSchedule(schedule([
    "2026-09-01",
    "2026-10-14",
    "2026-10-15",
    "2026-10-19",
    "2026-10-21",
    "2026-10-22",
  ]), {
    activationAt: new Date("2026-10-15T08:30:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialStartDate, "2026-10-15");
  assert.equal(value.trialEndDateExclusive, "2026-10-22");
  assert.equal(value.scheduleEventCount, 3);
});

test("trial activation uses university local date at UTC boundary", () => {
  const value = trialWindowFromSchedule(schedule([
    "2026-10-15",
    "2026-10-16",
    "2026-10-21",
    "2026-10-22",
  ]), {
    activationAt: new Date("2026-10-14T21:30:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialStartDate, "2026-10-15");
  assert.equal(value.trialEndDateExclusive, "2026-10-22");
});

test("activation after the final schedule date is closed", () => {
  const value = trialWindowFromSchedule(schedule(["2026-12-20", "2026-12-21"]), {
    activationAt: new Date("2026-12-22T07:00:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialWindowClosed, true);
  assert.equal(value.firstScheduleDate, "2026-12-20");
  assert.equal(value.lastScheduleDate, "2026-12-21");
});

test("activation on the final schedule date is allowed", () => {
  const value = trialWindowFromSchedule(schedule(["2026-12-20", "2026-12-21"]), {
    activationAt: new Date("2026-12-21T08:00:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialStartDate, "2026-12-21");
  assert.equal(value.trialEndDateExclusive, "2026-12-28");
  assert.equal(value.scheduleEventCount, 1);
});

test("a seven-day activation window with no lessons is reported as unavailable", () => {
  const value = trialWindowFromSchedule(schedule(["2026-09-01", "2026-10-20"]), {
    activationAt: new Date("2026-10-05T08:00:00Z"),
    timezone: "Asia/Yekaterinburg",
  });

  assert.equal(value.trialStartDate, "2026-10-05");
  assert.equal(value.trialEndDateExclusive, "2026-10-12");
  assert.equal(value.scheduleEventCount, 0);
});
