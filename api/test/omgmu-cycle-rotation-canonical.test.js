import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  buildCycleRotationCanonicalCandidate,
  parseCycleRotationGeometry,
} from "../src/adapters/omgmu/cycle-rotation-grid.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoded = fs.readFileSync(path.join(__dirname, "fixtures/omgmu-cycle-rotation-course4.geometry.json.gz.b64"), "utf8").trim();
const fixture = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
// The committed fixture predates O33 extraction. Keep its table geometry byte-stable
// and attach the explicit Russian PDF holiday line as source metadata here; the live
// extractor is independently exercised by the source-discovery workflow.
const geometry = {
  ...fixture,
  sourceCalendarExceptions: ["01.05", "09.05", "12.06"],
};
const academicCalendar = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../../universities/omgmu/academic-calendar-2025-2026-spring.json"),
  "utf8",
));
const SOURCE_HASH = "d3436fb8a1f40b4286ffd550004e477424c9424590128dbbf564340200c38daa";

function metadata(group = "485") {
  return {
    academicYear: academicCalendar.academic_year,
    semester: academicCalendar.semester,
    facultyCode: "medicine-international",
    facultyName: "Лечебное дело для иностранных граждан",
    course: 4,
    group,
    period: academicCalendar.period,
    calendarExceptions: academicCalendar.calendar_exceptions,
    conditionalCalendarExceptions: academicCalendar.conditional_calendar_exceptions,
  };
}

const source = {
  fileName: "07_medicine-international_course-4_cycles.pdf",
  fileHash: SOURCE_HASH,
};

function subsetGeometry(predicate) {
  return {
    ...geometry,
    cycles: geometry.cycles.map((cycle) => ({
      ...cycle,
      rows: cycle.rows.map((row) => ({
        ...row,
        groupCells: row.groupCells.filter((cell) => predicate(cycle, row, cell)),
      })).filter((row) => row.groupCells.length),
    })).filter((cycle) => cycle.rows.length),
  };
}

test("extracts Russian cycle geometry with real group spans and inherited discipline", () => {
  assert.equal(geometry.sourceLanguage, "ru");
  assert.deepEqual(geometry.sourceCalendarExceptions, ["01.05", "09.05", "12.06"]);
  assert.deepEqual(geometry.cycles.map((cycle) => cycle.cycleNo), [1, 2]);
  assert.deepEqual(geometry.cycles[0].groups.map((group) => group.code), ["485", "486"]);

  const lecture = geometry.cycles[0].rows.find((row) => row.rowIndex === 3);
  const cycle = geometry.cycles[0].rows.find((row) => row.rowIndex === 4);
  assert.deepEqual(lecture.groupCells[0].groups, ["485", "486"]);
  assert.deepEqual(cycle.groupCells[0].groups, ["485", "486"]);
  assert.equal(cycle.disciplineInherited, true);
  assert.equal(cycle.discipline, lecture.discipline);
});

test("O32/O34 keep 11.05 for the 11-lecture row but exclude it from the K.дн. 15 cycle row", () => {
  assert.equal(academicCalendar.calendar_year, 2026);
  assert.deepEqual(academicCalendar.calendar_exceptions, []);
  assert.deepEqual(academicCalendar.conditional_calendar_exceptions.map((item) => item.date), ["2026-05-11"]);

  const parsed = parseCycleRotationGeometry(geometry, {
    year: academicCalendar.calendar_year,
    calendarExceptions: metadata().calendarExceptions,
    conditionalCalendarExceptions: metadata().conditionalCalendarExceptions,
  });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.sourceSeries.length, 18);

  const therapyLecture = parsed.sourceSeries.find((record) => (
    record.discipline.includes("Факультетская терапия") && record.kind === "lecture"
  ));
  const therapyCycle = parsed.sourceSeries.find((record) => (
    record.discipline.includes("Факультетская терапия") && record.kind === "cycle"
  ));

  assert.equal(therapyLecture.declaredDays, 11);
  assert.equal(therapyLecture.mainDates.length, 11);
  assert.ok(therapyLecture.mainDates.includes("2026-05-11"));
  assert.equal(therapyLecture.calendarResolution.mode, "source_priority_keep");
  assert.deepEqual(therapyLecture.calendarResolution.keptDates, ["2026-05-11"]);
  assert.equal(therapyLecture.status, "ok");
  assert.ok(therapyLecture.ruleIds.includes("O32"));
  assert.ok(therapyLecture.ruleIds.includes("O34"));

  assert.equal(therapyCycle.declaredDays, 15);
  assert.equal(therapyCycle.mainDates.length, 15);
  assert.ok(!therapyCycle.mainDates.includes("2026-05-11"));
  assert.equal(therapyCycle.calendarResolution.mode, "external_exception_applied");
  assert.deepEqual(therapyCycle.calendarResolution.appliedDates, ["2026-05-11"]);
  assert.equal(therapyCycle.status, "ok");
  assert.ok(therapyCycle.ruleIds.includes("O20"));
  assert.ok(therapyCycle.ruleIds.includes("O26"));
  assert.ok(therapyCycle.ruleIds.includes("O32"));
  assert.ok(therapyCycle.ruleIds.includes("O34"));
});

test("O34 never chooses an external date merely to force an unrelated K.дн. mismatch", () => {
  const therapyCycleGeometry = subsetGeometry((_cycle, row) => (
    row.discipline.includes("Факультетская терапия") && row.rowIndex === 4
  ));
  therapyCycleGeometry.cycles[0].rows[0].declaredDays = 14;
  const parsed = parseCycleRotationGeometry(therapyCycleGeometry, {
    year: academicCalendar.calendar_year,
    conditionalCalendarExceptions: metadata().conditionalCalendarExceptions,
  });
  assert.equal(parsed.sourceSeries.length, 1);
  const record = parsed.sourceSeries[0];
  assert.equal(record.calendarResolution.mode, "unresolved");
  assert.equal(record.mainDates.length, 16);
  assert.equal(record.status, "needs_review");
  assert.ok(record.warnings.some((warning) => warning.includes("К.дн.=14") && warning.includes("=16")));
});

test("O19 merges a real two-slot cycle row into one user event while keeping source slots", () => {
  const surgeryGeometry = subsetGeometry((_cycle, row, cell) => (
    row.discipline.includes("Факультетская хирургия") && cell.groups.includes("485")
  ));
  const candidate = buildCycleRotationCanonicalCandidate(surgeryGeometry, { metadata: metadata("485"), source });
  assert.equal(candidate.sourceSeries.length, 1);
  assert.deepEqual(candidate.sourceSeries[0].sourceSlots, [
    { startTime: "08:20", endTime: "09:50" },
    { startTime: "10:00", endTime: "11:30" },
  ]);
  assert.ok(candidate.sourceSeries[0].ruleIds.includes("O19"));
  assert.ok(candidate.sourceSeries[0].ruleIds.includes("O33"));
  assert.equal(candidate.sourceSeries[0].status, "ok");
  assert.equal(candidate.batch.events.length, 12);
  assert.ok(candidate.batch.events.every((event) => event.timing.start_time === "08:20"));
  assert.ok(candidate.batch.events.every((event) => event.timing.end_time === "11:30"));
  assert.ok(candidate.batch.events.every((event) => event.lesson.type.code === "unknown"));

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T09:30:00.000Z",
    eventIdFactory: () => `evt_omgmu_cycle_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_cycle_surgery_1",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.match(prepared.ics, /DTSTART:20260529T082000/);
  assert.match(prepared.ics, /DTEND:20260529T113000/);
  assert.doesNotMatch(prepared.ics, /DTSTART:20260612T082000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
});

test("separate explicit-time credit is materialized and included in K.дн. validation", () => {
  const entGeometry = subsetGeometry((_cycle, row, cell) => (
    row.discipline === "Оториноларингология" && cell.groups.includes("485")
  ));
  const candidate = buildCycleRotationCanonicalCandidate(entGeometry, { metadata: metadata("485"), source });
  assert.equal(candidate.sourceSeries.length, 1);
  const record = candidate.sourceSeries[0];
  assert.equal(record.mainDates.length, 11);
  assert.equal(record.declaredDays, 12);
  assert.deepEqual(record.control, {
    date: "2026-07-29",
    explicitTime: { startTime: "08:20", endTime: "11:30" },
  });
  assert.equal(record.status, "ok");
  assert.ok(record.ruleIds.includes("O30"));
  assert.ok(record.ruleIds.includes("O37"));

  const credit = candidate.batch.events.find((event) => event.lesson.type.code === "credit");
  assert.equal(candidate.batch.events.length, 12);
  assert.equal(credit.timing.date, "2026-07-29");
  assert.equal(credit.timing.start_time, "08:20");
  assert.equal(credit.timing.end_time, "11:30");
});

test("O29 replaces the last cycle occurrence with one credit when control is same date without own time", () => {
  const reproGeometry = subsetGeometry((cycle, row, cell) => (
    cycle.cycleNo === 2 && row.discipline === "Основы репродуктологии" && cell.groups.includes("485")
  ));
  const candidate = buildCycleRotationCanonicalCandidate(reproGeometry, { metadata: metadata("485"), source });
  const record = candidate.sourceSeries[0];
  assert.equal(record.mainDates.length, 8);
  assert.equal(record.control.date, "2026-07-29");
  assert.equal(record.control.explicitTime, null);
  assert.equal(record.status, "ok");
  assert.ok(record.ruleIds.includes("O29"));
  assert.equal(candidate.batch.events.length, 8);

  const july29 = candidate.batch.events.filter((event) => event.timing.date === "2026-07-29");
  assert.equal(july29.length, 1);
  assert.equal(july29[0].lesson.type.code, "credit");
  assert.equal(july29[0].timing.start_time, "12:50");
  assert.equal(july29[0].timing.end_time, "16:00");
});

test("full group 485 passes canonical common pipeline with source-level O33 and series-scoped O32/O34", () => {
  const candidate = buildCycleRotationCanonicalCandidate(geometry, { metadata: metadata("485"), source });
  assert.equal(candidate.sourceSeries.length, 10);
  assert.equal(candidate.sourceSeries.filter((record) => record.status === "needs_review").length, 0);
  assert.equal(candidate.batch.events.length, 107);

  const therapyOnMay11 = candidate.batch.events.filter((event) => (
    event.lesson.discipline.normalized.includes("Факультетская терапия")
    && event.timing.date === "2026-05-11"
  ));
  assert.equal(therapyOnMay11.length, 1);
  assert.equal(therapyOnMay11[0].lesson.type.code, "lecture");
  assert.equal(therapyOnMay11[0].timing.start_time, "08:20");
  assert.equal(therapyOnMay11[0].timing.end_time, "10:00");

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T09:30:00.000Z",
    eventIdFactory: () => `evt_omgmu_cycle_full_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_cycle_485_full",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal((prepared.ics.match(/BEGIN:VEVENT/g) || []).length, 107);
  assert.match(prepared.ics, /DTSTART:20260511T082000/);
  assert.doesNotMatch(prepared.ics, /DTSTART:20260511T104000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
});

test("rejects non-Russian cycle geometry for production", () => {
  assert.throws(
    () => parseCycleRotationGeometry({ ...geometry, sourceLanguage: "en" }, { year: academicCalendar.calendar_year }),
    (error) => error.code === "OMG_CYCLE_ROTATION_RU_REQUIRED",
  );
});
