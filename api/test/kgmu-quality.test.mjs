import assert from "node:assert/strict";
import test from "node:test";
import { buildKgmuQualityReport } from "../src/adapters/kgmu/quality.mjs";

function downloadReport() {
  return {
    files: [
      { filename: "weekly.xlsx", url: "https://example.test/weekly.xlsx", sha256: "a".repeat(64), bytes: 1000 },
      { filename: "calendar.xlsx", url: "https://example.test/calendar.xlsx", sha256: "b".repeat(64), bytes: 2000 },
    ],
  };
}

test("KGMU quality keeps archive groups reference-only", () => {
  const report = buildKgmuQualityReport({
    academicYear: "2026/27",
    semester: 1,
    downloadReport: downloadReport(),
    weeklyReport: {
      reports: [{
        status: "parsed",
        layout: "weekly-grid",
        program: "pediatrics",
        course: 1,
        academicYear: "2025/2026",
        semester: 2,
        sourceFile: "weekly.xlsx",
        groups: {
          132: { stats: { eventCount: 278, unresolvedCount: 1, partialCount: 0 } },
        },
      }],
    },
    calendarReport: { reports: [] },
  });

  assert.equal(report.status, "waiting-for-target-period");
  assert.equal(report.targetGroupCount, 0);
  assert.equal(report.archiveReferenceGroupCount, 1);
  assert.equal(report.groups[0].status, "archive-reference");
  assert.equal(report.groups[0].sourceSha256, "a".repeat(64));
});

test("KGMU quality blocks a target weekly group with any parser ambiguity", () => {
  const report = buildKgmuQualityReport({
    academicYear: "2026/2027",
    semester: 1,
    downloadReport: downloadReport(),
    weeklyReport: {
      reports: [{
        status: "parsed",
        layout: "weekly-grid",
        program: "pediatrics",
        course: 1,
        academicYear: "2026/27",
        semester: 1,
        sourceFile: "weekly.xlsx",
        groups: {
          132: { stats: { eventCount: 240, unresolvedCount: 0, partialCount: 1 } },
        },
      }],
    },
    calendarReport: { reports: [] },
  });

  assert.equal(report.status, "needs-review");
  assert.equal(report.readyForPublicationPlan, false);
  assert.equal(report.blockedGroupCount, 1);
  assert.deepEqual(report.groups[0].blockers, { unresolved: 0, partial: 1, reviewMarkers: 0 });
});

test("KGMU quality marks clean weekly and calendar target groups ready", () => {
  const report = buildKgmuQualityReport({
    academicYear: "2026/2027",
    semester: 1,
    downloadReport: downloadReport(),
    weeklyReport: {
      reports: [{
        status: "parsed",
        layout: "weekly-grid",
        program: "pediatrics",
        course: 1,
        academicYear: "2026/2027",
        semester: 1,
        sourceFile: "weekly.xlsx",
        groups: {
          132: { stats: { eventCount: 240, unresolvedCount: 0, partialCount: 0 } },
        },
      }],
    },
    calendarReport: {
      reports: [{
        status: "parsed",
        layout: "calendar-grid",
        program: "medicine",
        course: 5,
        academicYear: "2026/2027",
        semester: 1,
        sourceFile: "calendar.xlsx",
        groups: {
          501: {
            blocks: [
              { kind: "discipline-cycle", status: "matched", requiresReview: false },
              { kind: "independent-study", status: "marker", requiresReview: false },
            ],
          },
        },
      }],
    },
  });

  assert.equal(report.status, "ready-for-publication-plan");
  assert.equal(report.readyForPublicationPlan, true);
  assert.equal(report.readyGroupCount, 2);
  assert.equal(report.blockedGroupCount, 0);
});

test("KGMU quality blocks calendar review markers", () => {
  const report = buildKgmuQualityReport({
    academicYear: "2026/2027",
    semester: 1,
    downloadReport: downloadReport(),
    weeklyReport: { reports: [] },
    calendarReport: {
      reports: [{
        status: "parsed",
        layout: "calendar-grid",
        program: "medicine",
        course: 6,
        academicYear: "2026/2027",
        semester: 1,
        sourceFile: "calendar.xlsx",
        groups: {
          601: {
            blocks: [
              { kind: "discipline-cycle", status: "matched", requiresReview: false },
              { kind: "exam-period", status: "marker", requiresReview: true },
            ],
          },
        },
      }],
    },
  });

  assert.equal(report.status, "needs-review");
  assert.equal(report.groups[0].blockers.reviewMarkers, 1);
});
