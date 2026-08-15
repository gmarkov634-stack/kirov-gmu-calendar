import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildWeeklyGridCanonicalCandidate } from "../src/adapters/omgmu/weekly-grid.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../../universities/omgmu/manual-review.json"), "utf8"));

function metadata({ group, course, stream }) {
  return {
    academicYear: "2025/2026",
    semester: "spring",
    facultyCode: "medicine-international",
    facultyName: "Лечебное дело для иностранных граждан",
    course,
    stream,
    group,
    period: { start_date: "2026-04-06", end_date: "2026-08-08", week1_start_date: "2026-04-06" },
    calendarExceptions: ["2026-05-01", "2026-05-09", "2026-06-12"],
  };
}

function geometry(groups, weekday, text) {
  return {
    version: 1,
    sourceProfile: "weekly_grid",
    sourceLanguage: "ru",
    pageNumber: 2,
    groups: groups.map((code, index) => ({ code, x0: index * 10, x1: (index + 1) * 10 })),
    rows: [{
      rowIndex: 1,
      weekday,
      cells: [{ bbox: [0, 10, groups.length * 10, 20], groups, text }],
    }],
  };
}

function prepare(batch, prefix) {
  let counter = 0;
  return prepareSchedulePublication(batch, {
    now: "2026-08-15T08:00:00.000Z",
    eventIdFactory: () => `evt_${prefix}_${++counter}`,
    versionIdFactory: () => `ver_${prefix}_1`,
  });
}

test("approved review 2113 restores the confirmed Thursday dates and passes common QA", () => {
  const candidate = buildWeeklyGridCanonicalCandidate(
    geometry(["2113", "2114"], 5, "16.20-18.45 Биохимия, 13 з.: 09.04-02.07"),
    {
      metadata: metadata({ group: "2113", course: 2, stream: "2" }),
      source: {
        fileName: "04_medicine-international_course-2_stream-2_combined.pdf",
        fileHash: "35983ba32a518f9d61c184ba946907ec9d56b2bd03a99d2ace8bb1b3ad8afc69",
      },
      reviewRegistry: registry,
    },
  );

  assert.equal(candidate.review.group, "2113");
  assert.equal(candidate.review.resolutionType, "override-series-dates");
  assert.equal(candidate.sourceSeries.length, 1);
  assert.equal(candidate.sourceSeries[0].status, "warning");
  assert.equal(candidate.sourceSeries[0].dates.length, 13);
  assert.deepEqual(candidate.sourceSeries[0].dates.slice(0, 2), ["2026-04-09", "2026-04-16"]);
  assert.equal(candidate.sourceSeries[0].dates.at(-1), "2026-07-02");
  assert.ok(candidate.sourceSeries[0].ruleIds.includes("manual-review:2026-08-10:2113"));
  assert.equal(candidate.batch.events.length, 13);
  assert.ok(candidate.batch.events.every((event) => event.parse.status === "warning"));

  const prepared = prepare(candidate.batch, "2113_review");
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.match(prepared.ics, /DTSTART:20260409T162000/);
});

test("approved review 389 accepts the exact printed 24.06 date despite Thursday row", () => {
  const candidate = buildWeeklyGridCanonicalCandidate(
    geometry(["389", "393"], 4, "14.20-16.00 Спортивные игры/ Плавание/Атлетическая гимнастика, 1 з.: 24.06"),
    {
      metadata: metadata({ group: "389", course: 3, stream: null }),
      source: {
        fileName: "05_medicine-international_course-3_combined.pdf",
        fileHash: "5a77c3eaede8e32887bc8c768cb19b5aaa6d9506249b2484ffb0bbb2f3bc9427",
      },
      reviewRegistry: registry,
    },
  );

  assert.equal(candidate.review.group, "389");
  assert.deepEqual(candidate.sourceSeries[0].dates, ["2026-06-24"]);
  assert.equal(candidate.sourceSeries[0].status, "warning");
  assert.ok(candidate.sourceSeries[0].ruleIds.includes("manual-review:2026-08-10:389"));
  const prepared = prepare(candidate.batch, "389_review");
  assert.equal(prepared.inputQa.publishable, true);
  assert.match(prepared.ics, /DTSTART:20260624T142000/);
});

test("approved review is invalidated by any PDF SHA change", () => {
  assert.throws(
    () => buildWeeklyGridCanonicalCandidate(
      geometry(["2113", "2114"], 5, "16.20-18.45 Биохимия, 13 з.: 09.04-02.07"),
      {
        metadata: metadata({ group: "2113", course: 2, stream: "2" }),
        source: {
          fileName: "04_medicine-international_course-2_stream-2_combined.pdf",
          fileHash: "0".repeat(64),
        },
        reviewRegistry: registry,
      },
    ),
    (error) => error.code === "OMG_WEEKLY_REVIEW_SOURCE_CHANGED",
  );
});
