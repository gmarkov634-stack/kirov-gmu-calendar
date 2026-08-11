import assert from "node:assert/strict";
import test from "node:test";
import { buildKgmuPublicationPlan, buildKgmuSchedule } from "../src/adapters/kgmu/publish.mjs";

const hash = "a".repeat(64);

function quality(overrides = {}) {
  return {
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupCode: "132",
    groupId: "kgmu:pediatrics:1:132",
    layout: "weekly-grid",
    academicYear: "2026/27",
    semester: 1,
    sourceFile: "weekly.xlsx",
    sourceUrl: "https://example.test/weekly.xlsx",
    sourceSha256: hash,
    status: "ready-for-publication-plan",
    ...overrides,
  };
}

test("archive groups never receive a publication key", () => {
  const plan = buildKgmuPublicationPlan({
    qualityReport: { groups: [quality({ status: "archive-reference", academicYear: "2025/2026", semester: 2 })] },
    weeklyReport: { reports: [] },
    calendarReport: { reports: [] },
  });
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.blocked[0].reason, "archive-reference");
  assert.equal("key" in plan.blocked[0], false);
});

test("builds a weekly KGMU schedule with Moscow offset and versioned key", () => {
  const q = quality();
  const weeklyReport = {
    reports: [{
      sourceFile: "weekly.xlsx",
      groups: {
        132: {
          events: [{
            id: "event-1",
            date: "2026-09-01",
            start: "08:00",
            end: "09:30",
            title: "Анатомия",
            locationText: "ул. Карла Маркса, 112",
            sourceCell: "C7",
            raw: "08.00-09.30 Анатомия 01.09",
          }],
        },
      },
    }],
  };
  const plan = buildKgmuPublicationPlan({
    qualityReport: { groups: [q] },
    weeklyReport,
    calendarReport: { reports: [] },
  });
  assert.equal(plan.publishable.length, 1);
  assert.equal(plan.publishable[0].schedule.academicYear, "2026/2027");
  assert.equal(plan.publishable[0].schedule.events[0].start, "2026-09-01T08:00:00+03:00");
  assert.equal(plan.publishable[0].schedule.events[0].end, "2026-09-01T09:30:00+03:00");
  assert.equal(
    plan.publishable[0].key,
    "schedules/kgmu/pediatrics/1/2026-2027/semester-1/kgmu%3Apediatrics%3A1%3A132.json",
  );
});

test("preserves a date-specific weekly time override already resolved by the parser", () => {
  const schedule = buildKgmuSchedule({
    quality: quality(),
    weeklyReport: {
      reports: [{
        sourceFile: "weekly.xlsx",
        groups: {
          132: {
            events: [
              { id: "ordinary", date: "2026-05-25", start: "13:45", end: "15:15", title: "Гистология" },
              { id: "override", date: "2026-06-01", start: "13:45", end: "16:55", title: "Гистология" },
            ],
          },
        },
      }],
    },
    calendarReport: { reports: [] },
  });
  assert.equal(schedule.events[0].end, "2026-05-25T15:15:00+03:00");
  assert.equal(schedule.events[1].end, "2026-06-01T16:55:00+03:00");
});

test("expands a clean calendar-grid cycle into dated events", () => {
  const q = quality({
    program: "medicine",
    course: 5,
    groupCode: "501",
    groupId: "kgmu:medicine:5:501",
    layout: "calendar-grid",
    sourceFile: "calendar.xlsx",
    sourceUrl: "https://example.test/calendar.xlsx",
  });
  const schedule = buildKgmuSchedule({
    quality: q,
    weeklyReport: { reports: [] },
    calendarReport: {
      reports: [{
        sourceFile: "calendar.xlsx",
        groups: {
          501: {
            blocks: [{
              kind: "discipline-cycle",
              status: "matched",
              requiresReview: false,
              metadataMatch: "Госпитальная хирургия",
              sourceCell: "D10",
              raw: "Госпитальная хирургия",
              dates: ["2026-09-01", "2026-09-02", "2026-09-03"],
              address: "ул. Тестовая, 1",
              timing: {
                status: "resolved",
                firstDateTime: { start: "12:00", end: "15:00" },
                remainingDatesTime: { start: "08:30", end: "11:35" },
              },
            }],
          },
        },
      }],
    },
  });
  assert.equal(schedule.events.length, 3);
  assert.equal(schedule.events[0].start, "2026-09-01T12:00:00+03:00");
  assert.equal(schedule.events[1].start, "2026-09-02T08:30:00+03:00");
  assert.equal(schedule.events[0].title, "Госпитальная хирургия");
});

test("blocks a supposedly ready group when the source hash is missing", () => {
  const plan = buildKgmuPublicationPlan({
    qualityReport: { groups: [quality({ sourceSha256: null })] },
    weeklyReport: { reports: [{ sourceFile: "weekly.xlsx", groups: { 132: { events: [] } } }] },
    calendarReport: { reports: [] },
  });
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.blocked[0].reason, "missing-source-hash");
});
