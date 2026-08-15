import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseWeeklyGeometry } from "../src/adapters/omgmu/weekly-geometry.mjs";
import { buildWeeklyGridCanonicalCandidate } from "../src/adapters/omgmu/weekly-grid.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/omgmu-2.1-ru-full-geometry.json"), "utf8"));
const SOURCE_HASH = "f34129fe1a98ca8935620fce10b3adab7ca3858e5f5e842fe38bcfc85491d3da";
const calendarExceptions = ["2026-05-01", "2026-05-09", "2026-06-12"];

const geometry = {
  ...fixture,
  sourceAliases: [
    {
      alias: "Микробиология, В/ Иммунология",
      expansion: "Микробиология, вирусология/ Иммунология",
    },
    {
      alias: "Топ. анатомия и ОХ/ **",
      expansion: "Топографическая анатомия и оперативная хирургия/ Частные вопросы клинической анатомии",
    },
  ],
};

function metadata(group = "2101") {
  return {
    academicYear: "2025/2026",
    semester: "spring",
    facultyCode: "medicine-international",
    facultyName: "Лечебное дело для иностранных граждан",
    course: 2,
    stream: "1",
    group,
    period: {
      start_date: "2026-04-06",
      end_date: "2026-08-15",
      week1_start_date: "2026-04-06",
    },
    calendarExceptions,
  };
}

const source = { fileName: "2.1.pdf", fileHash: SOURCE_HASH };

test("full 2.1 geometry has no parser diagnostics or needs_review series", () => {
  const parsed = parseWeeklyGeometry(geometry, { year: 2026, calendarExceptions });
  assert.deepEqual(parsed.groups, ["2101", "2102", "2103", "2104", "2105", "2106", "2107", "2108", "2109", "2110"]);
  assert.deepEqual(parsed.diagnostics, []);
  assert.ok(parsed.series.length > 50);
  assert.ok(parsed.series.every((series) => series.status === "ok"));

  const noCommaCounter = parsed.series.find((series) => series.discipline === "Нормальная физиология" && series.startTime === "13:30");
  assert.equal(noCommaCounter.declaredCount, 17);
  assert.equal(noCommaCounter.dates.length, 17);
  assert.doesNotMatch(noCommaCounter.discipline, /17\s*з/i);

  const hall = parsed.series.find((series) => series.discipline === "Нормальная физиология" && series.startTime === "14:00");
  assert.equal(hall.location, "АЗ ГК");
  assert.ok(hall.ruleIds.includes("O58"));
});

test("O59 resolves the Russian source-local alias before O13 splits paired counts", () => {
  const parsed = parseWeeklyGeometry(geometry, { year: 2026, calendarExceptions });
  const sourceRef = "pdf:p2:row-11:bbox-32.52,289.75,190.34,313.27:groups-2101+2102";
  const pair = parsed.series.filter((series) => series.references[0].range === sourceRef);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map((series) => series.discipline), [
    "Топографическая анатомия и оперативная хирургия",
    "Частные вопросы клинической анатомии",
  ]);
  assert.deepEqual(pair.map((series) => series.declaredCount), [7, 11]);
  assert.deepEqual(pair.map((series) => series.dates.length), [7, 11]);
  assert.ok(pair.every((series) => series.ruleIds.includes("O13")));
  assert.ok(pair.every((series) => series.ruleIds.includes("O59")));
  assert.equal(pair[0].dates.at(-1) < pair[1].dates[0], true);
});

test("O14 keeps physical-culture alternatives neutral instead of choosing a section", () => {
  const parsed = parseWeeklyGeometry(geometry, { year: 2026, calendarExceptions });
  const physical = parsed.series.find((series) => series.groups.includes("2101") && series.startTime === "10:40" && series.dates.includes("2026-04-09"));
  assert.equal(physical.discipline, "Физическая культура и спорт");
  assert.deepEqual(physical.declaredCounts, [3, 14]);
  assert.equal(physical.dates.length, 17);
  assert.ok(physical.ruleIds.includes("O14"));
  assert.match(physical.sourceNote, /Спортивные игры/);
  assert.match(physical.sourceNote, /Атлетическая гимнастика/);
});

test("group 2101 passes full PDF weekly geometry to canonical common pipeline and floating ICS", () => {
  const candidate = buildWeeklyGridCanonicalCandidate(geometry, { metadata: metadata("2101"), source });
  assert.equal(candidate.sourceSeries.length, 21);
  assert.ok(candidate.sourceSeries.every((series) => series.status === "ok"));
  assert.equal(candidate.merges.length, 0);
  assert.equal(candidate.userSeries.length, 176);
  assert.equal(candidate.batch.events.length, 176);
  assert.ok(candidate.batch.events.every((event) => event.university.code === "omgmu"));
  assert.ok(candidate.batch.events.every((event) => event.audience.group === "2101"));
  assert.ok(candidate.batch.events.every((event) => event.timing.time_mode === "floating"));

  const topAnatomy = candidate.batch.events.filter((event) => event.lesson.discipline.normalized === "Топографическая анатомия и оперативная хирургия" && event.timing.start_time === "16:00");
  const particular = candidate.batch.events.filter((event) => event.lesson.discipline.normalized === "Частные вопросы клинической анатомии" && event.timing.start_time === "16:00");
  assert.equal(topAnatomy.length, 7);
  assert.equal(particular.length, 11);

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T08:30:00.000Z",
    eventIdFactory: () => `evt_omgmu_2101_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_weekly_2101_full",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal((prepared.ics.match(/BEGIN:VEVENT/g) || []).length, 176);
  assert.match(prepared.ics, /DTSTART:20260406T113000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
});
