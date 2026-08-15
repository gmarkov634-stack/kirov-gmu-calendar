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
const geometry = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
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
  assert.deepEqual(geometry.cycles.map((cycle) => cycle.cycleNo), [1, 2]);
  assert.deepEqual(geometry.cycles[0].groups.map((group) => group.code), ["485", "486"]);

  const lecture = geometry.cycles[0].rows.find((row) => row.rowIndex === 3);
  const cycle = geometry.cycles[0].rows.find((row) => row.rowIndex === 4);
  assert.deepEqual(lecture.groupCells[0].groups, ["485", "486"]);
  assert.deepEqual(cycle.groupCells[0].groups, ["485", "486"]);
  assert.equal(cycle.disciplineInherited, true);
  assert.equal(cycle.discipline, lecture.discipline);
});

test("verified 2026 calendar metadata resolves the real K.дн. 15 cycle without parser guessing", () => {
  assert.equal(academicCalendar.calendar_year, 2026);
  assert.ok(academicCalendar.calendar_exceptions.includes("2026-05-11"));

  const parsed = parseCycleRotationGeometry(geometry, {
    year: academicCalendar.calendar_year,
    calendarExceptions: metadata().calendarExceptions,
  });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.sourceSeries.length, 18);
  assert.equal(parsed.sourceSeries.filter((record) => record.groups.includes("485")).length, 10);
  assert.equal(parsed.sourceSeries.filter((record) => record.groups.includes("486")).length, 10);

  const therapyCycle = parsed.sourceSeries.find((record) => (
    record.discipline.includes("Факультетская терапия") && record.kind === "cycle"
  ));
  assert.deepEqual(therapyCycle.groups, ["485", "486"]);
  assert.equal(therapyCycle.declaredDays, 15);
  assert.equal(therapyCycle.mainDates.length, 15);
  assert.equal(therapyCycle.status, "ok");
  assert.ok(therapyCycle.ruleIds.includes("O20"));
  assert.ok(therapyCycle.ruleIds.includes("O26"));
  assert.ok(!therapyCycle.mainDates.includes("2026-05-11"));
  assert.ok(!therapyCycle.warnings.some((warning) => warning.includes("К.дн.")));
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

test("full group 485 passes canonical common pipeline with verified source calendar metadata", () => {
  const candidate = buildCycleRotationCanonicalCandidate(geometry, { metadata: metadata("485"), source });
  assert.equal(candidate.sourceSeries.length, 10);
  assert.equal(candidate.sourceSeries.filter((record) => record.status === "needs_review").length, 0);
  assert.equal(candidate.batch.events.length, 106);

  const therapyOnHoliday = candidate.batch.events.filter((event) => (
    event.lesson.discipline.normalized.includes("Факультетская терапия")
    && event.timing.date === "2026-05-11"
  ));
  assert.equal(therapyOnHoliday.length, 0);

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T09:30:00.000Z",
    eventIdFactory: () => `evt_omgmu_cycle_full_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_cycle_485_full",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal((prepared.ics.match(/BEGIN:VEVENT/g) || []).length, 106);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
});

test("rejects non-Russian cycle geometry for production", () => {
  assert.throws(
    () => parseCycleRotationGeometry({ ...geometry, sourceLanguage: "en" }, { year: academicCalendar.calendar_year }),
    (error) => error.code === "OMG_CYCLE_ROTATION_RU_REQUIRED",
  );
});