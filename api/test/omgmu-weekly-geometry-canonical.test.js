import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseWeeklyGeometry } from "../src/adapters/omgmu/weekly-geometry.mjs";
import {
  buildWeeklyGridCanonicalBatch,
  buildWeeklyGridCanonicalCandidate,
} from "../src/adapters/omgmu/weekly-grid.mjs";
import { materializeWeeklyUserSeries } from "../src/adapters/omgmu/weekly-o65.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/omgmu-1.2-ru-monday-geometry.json"), "utf8"));
const SOURCE_HASH = "f1964e264d14d4b31de3e72e4b3e1f77c5cc7d4972e2d6f3c408afba9a5417e7";

function metadata(group = "1109") {
  return {
    academicYear: "2025/2026",
    semester: "spring",
    facultyCode: "medicine-international",
    facultyName: "Лечебное дело для иностранных граждан",
    course: 1,
    stream: "2",
    group,
    period: {
      start_date: "2026-04-06",
      end_date: "2026-08-08",
      week1_start_date: "2026-04-06",
    },
    calendarExceptions: ["2026-05-01", "2026-05-09", "2026-06-12"],
  };
}

const source = { fileName: "1.2.pdf", fileHash: SOURCE_HASH };

function histologyOnlyGeometry() {
  return {
    ...fixture,
    rows: fixture.rows.filter((row) => [3, 4].includes(row.rowIndex)).map((row) => ({
      ...row,
      cells: row.cells.filter((cell) => cell.groups.includes("1109") && cell.text.includes("Гистология")),
    })),
  };
}

test("uses actual PDF cell span for O16 group attribution", () => {
  assert.deepEqual(fixture.groups.map((group) => group.code), ["1107", "1108", "1109", "1110", "1111", "1112"]);

  const row3Histology = fixture.rows.find((row) => row.rowIndex === 3).cells.find((cell) => cell.text.includes("Гистология"));
  const row4Histology = fixture.rows.find((row) => row.rowIndex === 4).cells.find((cell) => cell.text.includes("Гистология"));
  assert.deepEqual(row3Histology.groups, ["1109", "1110"]);
  assert.deepEqual(row4Histology.groups, ["1109", "1110"]);
  assert.deepEqual(row3Histology.bbox, [233.93, 184.58, 396.94, 205.82]);
  assert.deepEqual(row4Histology.bbox, [233.93, 205.82, 396.94, 226.97]);
});

test("keeps two O65 histology source-series independent with their own counters/ranges/evidence", () => {
  const parsed = parseWeeklyGeometry(histologyOnlyGeometry(), { year: 2026 });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.series.length, 2);

  const [first, second] = parsed.series;
  assert.equal(first.discipline, "Гистология, эмбриология, цитология");
  assert.equal(first.startTime, "13:30");
  assert.equal(first.endTime, "15:55");
  assert.equal(first.dates.length, 18);
  assert.equal(first.declaredCount, 18);
  assert.equal(first.dateExpression, "06.04-03.08");
  assert.ok(first.dates.includes("2026-07-20"));
  assert.deepEqual(first.groups, ["1109", "1110"]);
  assert.ok(first.ruleIds.includes("O16"));
  assert.ok(first.references[0].range.includes("bbox-233.93,184.58,396.94,205.82"));

  assert.equal(second.startTime, "16:00");
  assert.equal(second.endTime, "18:25");
  assert.equal(second.declaredCount, 1);
  assert.equal(second.dateExpression, "20.07");
  assert.deepEqual(second.dates, ["2026-07-20"]);
  assert.deepEqual(second.groups, ["1109", "1110"]);
  assert.notEqual(first.references[0].range, second.references[0].range);
});

test("O65 materializes one 13:30-18:25 user event on 20.07 while preserving both source-series", () => {
  const candidate = buildWeeklyGridCanonicalCandidate(histologyOnlyGeometry(), { metadata: metadata("1109"), source });
  assert.equal(candidate.sourceSeries.length, 2);
  assert.deepEqual(candidate.sourceSeries.map((series) => series.declaredCount), [18, 1]);
  assert.equal(candidate.merges.length, 1);
  assert.deepEqual(candidate.merges[0], {
    ruleId: "O65",
    group: "1109",
    date: "2026-07-20",
    discipline: "Гистология, эмбриология, цитология",
    startTime: "13:30",
    endTime: "18:25",
    sourceReferences: [
      "pdf:p2:row-3:bbox-233.93,184.58,396.94,205.82:groups-1109+1110",
      "pdf:p2:row-4:bbox-233.93,205.82,396.94,226.97:groups-1109+1110",
    ],
  });

  const mergedSeries = candidate.userSeries.find((series) => series.dates[0] === "2026-07-20");
  assert.equal(mergedSeries.o65Merged, true);
  assert.equal(mergedSeries.startTime, "13:30");
  assert.equal(mergedSeries.endTime, "18:25");
  assert.equal(mergedSeries.sourceSeriesEvidence.length, 2);
  assert.deepEqual(mergedSeries.sourceSeriesEvidence.map((part) => part.declaredCount), [18, 1]);
  assert.deepEqual(mergedSeries.sourceSeriesEvidence.map((part) => part.dateExpression), ["06.04-03.08", "20.07"]);
  assert.ok(mergedSeries.ruleIds.includes("O65"));

  const batch = candidate.batch;
  assert.equal(batch.events.length, 18);
  assert.ok(batch.events.every((event) => event.university.code === "omgmu"));
  assert.ok(batch.events.every((event) => event.audience.group === "1109"));
  assert.ok(batch.events.every((event) => event.timing.time_mode === "floating"));
  assert.ok(batch.events.every((event) => event.lesson.joint_groups.includes("1110")));

  const july20 = batch.events.filter((event) => event.timing.date === "2026-07-20");
  assert.equal(july20.length, 1);
  assert.equal(july20[0].timing.start_time, "13:30");
  assert.equal(july20[0].timing.end_time, "18:25");
  assert.ok(july20[0].parse.rule_ids.includes("O65"));
  assert.equal(july20[0].source.references.length, 2);
  assert.match(july20[0].source.raw_text, /13\.30-15\.55/);
  assert.match(july20[0].source.raw_text, /16\.00-18\.25/);

  let eventNo = 0;
  const prepared = prepareSchedulePublication(batch, {
    now: "2026-08-15T07:00:00.000Z",
    eventIdFactory: () => `evt_omgmu_weekly_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_weekly_geometry_1",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.match(prepared.ics, /DTSTART:20260720T133000/);
  assert.match(prepared.ics, /DTEND:20260720T182500/);
  assert.doesNotMatch(prepared.ics, /DTSTART:20260720T160000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
});

test("O65 does not jump across an intervening event", () => {
  const parsed = parseWeeklyGeometry(histologyOnlyGeometry(), { year: 2026 });
  const sourceSeries = [
    ...parsed.series,
    {
      discipline: "Другая дисциплина",
      disciplineNormalized: "Другая дисциплина",
      disciplineRaw: "Другая дисциплина",
      startTime: "15:57",
      endTime: "15:59",
      dates: ["2026-07-20"],
      dateExpression: "20.07",
      declaredCount: 1,
      declaredUnit: "з.",
      groups: ["1109", "1110"],
      status: "ok",
      warnings: [],
      ruleIds: ["O03"],
      references: [{ role: "lesson", range: "test:intervening" }],
      rawSource: "intervening",
      kind: "unknown",
      typeRaw: null,
      location: "",
      sourceNote: "",
      geometry: { pageNumber: 2, rowIndex: 4, bbox: [233.93, 200, 396.94, 202], groups: ["1109", "1110"] },
    },
  ];

  const materialized = materializeWeeklyUserSeries(sourceSeries, { group: "1109" });
  assert.equal(materialized.merges.length, 0);
  assert.equal(materialized.userSeries.filter((series) => series.dates[0] === "2026-07-20").length, 3);
});

test("fails closed when one merged cell contains unresolved same-slot disciplines", () => {
  const parsed = parseWeeklyGeometry(fixture, { year: 2026 });
  const psychology = parsed.series.find((series) => series.discipline === "Психологические основы деятельности врача");
  const bioethics = parsed.series.find((series) => series.discipline === "Биоэтика" && series.startTime === "11:00");
  assert.equal(psychology.status, "needs_review");
  assert.equal(bioethics.status, "needs_review");
  assert.ok(psychology.ruleIds.includes("O06"));
  assert.ok(psychology.warnings.some((warning) => warning.startsWith("O06:")));
});

test("O57 count mismatch stays needs_review and common input QA blocks it", () => {
  const geometry = {
    version: 1,
    sourceProfile: "weekly_grid",
    sourceLanguage: "ru",
    pageNumber: 2,
    groups: fixture.groups,
    rows: [{
      rowIndex: 5,
      weekday: 2,
      cells: [{
        bbox: [70.944, 247.0, 560.04, 270.0],
        groups: fixture.groups.map((group) => group.code),
        text: "08.30-10.10 Спортивные игры/Плавание/Атлетическая гимнастика, 5 занятий: 23.06-14.07",
      }],
    }],
  };

  const parsed = parseWeeklyGeometry(geometry, { year: 2026 });
  assert.equal(parsed.series.length, 1);
  assert.deepEqual(parsed.series[0].dates, ["2026-06-23", "2026-06-30", "2026-07-07", "2026-07-14"]);
  assert.equal(parsed.series[0].declaredCount, 5);
  assert.equal(parsed.series[0].status, "needs_review");
  assert.ok(parsed.series[0].ruleIds.includes("O57"));
  assert.ok(parsed.series[0].warnings.some((warning) => warning.includes("declared 5") && warning.includes("resolved 4")));

  const batch = buildWeeklyGridCanonicalBatch(geometry, { metadata: metadata("1109"), source });
  assert.throws(
    () => prepareSchedulePublication(batch, {
      now: "2026-08-15T07:00:00.000Z",
      eventIdFactory: () => "evt_never",
      versionIdFactory: () => "ver_never",
    }),
    (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.stage === "input",
  );
});

test("rejects non-Russian geometry for production", () => {
  assert.throws(
    () => parseWeeklyGeometry({ ...histologyOnlyGeometry(), sourceLanguage: "en" }, { year: 2026 }),
    (error) => error.code === "OMG_WEEKLY_GRID_RU_REQUIRED",
  );
});
