import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar } from "../src/calendar.js";
import { addCalendarDays, projectTrialSchedule, trialWindowFromSchedule } from "../src/trial-projection.js";

function event(id, date, index) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: "ver_trial_projection",
      fingerprint: `sha256:${String(index).padStart(64, "a").slice(-64)}`,
      revision: 1,
      created_at: "2026-08-15T07:00:00.000Z",
      updated_at: "2026-08-15T07:00:00.000Z",
    },
    timing: {
      date,
      start_time: "09:00",
      end_time: "10:30",
      all_day: false,
      time_mode: "floating",
    },
    derived: {
      sequence: { index, total: 12, bucket: "class" },
    },
    calendar: {
      title: `Педиатрия ${index}`,
      description: `${index} из 12`,
      location: null,
    },
  };
}

function schedule() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      course: 1,
      group: "131",
      period: { start_date: "2026-09-01", end_date: "2026-12-31", week1_start_date: "2026-08-31" },
      schedule_version_id: "ver_trial_projection",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"b".repeat(64)}`,
      version_created_at: "2026-08-15T07:00:00.000Z",
    },
    events: [
      event("evt_day1", "2026-09-01", 4),
      event("evt_day7", "2026-09-07", 5),
      event("evt_day8", "2026-09-08", 6),
    ],
  };
}

test("trial window starts at first actual class date and spans exactly seven calendar days", () => {
  assert.deepEqual(trialWindowFromSchedule(schedule()), {
    trialStartDate: "2026-09-01",
    trialEndDateExclusive: "2026-09-08",
  });
  assert.equal(addCalendarDays("2026-12-29", 7), "2027-01-05");
});

test("canonical trial projection keeps only the fixed week and one deterministic conversion event", () => {
  const trial = {
    status: "active",
    groupId: "kgmu:pediatrics:1:131",
    conversionId: "C".repeat(43),
    trialStartDate: "2026-09-01",
    trialEndDateExclusive: "2026-09-08",
    createdAt: "2026-08-15T07:00:00.000Z",
  };
  const projected = projectTrialSchedule(schedule(), trial, {
    continueUrl: "https://example.test/?continue=abc",
  });

  assert.equal(projected.events.length, 3);
  assert.deepEqual(projected.events.slice(0, 2).map((item) => item.system.event_id), ["evt_day1", "evt_day7"]);
  assert.equal(projected.events[0].derived.sequence.index, 4);
  assert.equal(projected.events[0].derived.sequence.total, 12);
  assert.equal(projected.events[2].timing.date, "2026-09-08");
  assert.equal(projected.events[2].timing.all_day, true);
  assert.equal(projected.events[2].calendar.title, "Продолжить календарь на семестр");

  const second = projectTrialSchedule(schedule(), trial, { continueUrl: "https://example.test/?continue=abc" });
  assert.equal(second.events[2].system.event_id, projected.events[2].system.event_id);

  const ics = buildCalendar(projected);
  assert.match(ics, /UID:evt_day1@kgmu-calendar/);
  assert.match(ics, /UID:evt_day7@kgmu-calendar/);
  assert.doesNotMatch(ics, /UID:evt_day8@kgmu-calendar/);
  assert.match(ics, /SUMMARY:Продолжить календарь на семестр/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260908/);
});

test("revoked or upgraded trial projection contains no events", () => {
  const base = {
    groupId: "kgmu:pediatrics:1:131",
    conversionId: "C".repeat(43),
    trialStartDate: "2026-09-01",
    trialEndDateExclusive: "2026-09-08",
  };
  assert.equal(projectTrialSchedule(schedule(), { ...base, status: "revoked" }).events.length, 0);
  assert.equal(projectTrialSchedule(schedule(), { ...base, status: "upgraded" }).events.length, 0);
});

test("legacy schedule projection follows the same exclusive end boundary", () => {
  const legacy = {
    university: "kgmu",
    group: "131",
    events: [
      { id: "a", title: "A", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:00:00+03:00" },
      { id: "b", title: "B", start: "2026-09-08T09:00:00+03:00", end: "2026-09-08T10:00:00+03:00" },
    ],
  };
  const projected = projectTrialSchedule(legacy, {
    status: "active",
    conversionId: "D".repeat(43),
    trialStartDate: "2026-09-01",
    trialEndDateExclusive: "2026-09-08",
  });
  assert.equal(projected.events.length, 2);
  assert.equal(projected.events[0].id, "a");
  assert.equal(projected.events[1].allDay, true);
  assert.equal(projected.events[1].start, "2026-09-08");
});
