import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCourseLectureListCanonicalBatch } from "../src/adapters/omgmu/course-lecture-list.mjs";
import { parseFourthCourseLectures } from "../src/adapters/omgmu/fourth-parser.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "omgmu-4lek-ru-2025-26.txt");
const SOURCE_HASH = "6e8cf99d14f53eb2a441cff588d39e619574863d8e5d12b08f4939113ac906fe";

async function sourceText() {
  return fs.readFile(FIXTURE, "utf8");
}

function adapterOptions() {
  return {
    metadata: {
      academicYear: "2025/2026",
      semester: "spring",
      facultyCode: "medicine-international",
      facultyName: "Лечебное дело для иностранных граждан",
      course: 4,
      groupCode: "485",
      period: {
        start_date: "2026-04-06",
        end_date: "2026-08-08",
        week1_start_date: "2026-04-06",
      },
    },
    source: {
      fileName: "4lek.pdf",
      fileHash: SOURCE_HASH,
    },
  };
}

test("actual Russian 4lek fixture becomes evidence-rich course_lecture_list source series", async () => {
  const records = parseFourthCourseLectures(await sourceText());
  assert.equal(records.length, 20);
  assert.equal(records.reduce((sum, record) => sum + record.dates.length, 0), 69);
  assert.ok(records.every((record) => record.status === "ok"));
  assert.ok(records.every((record) => record.dates.length === record.declaredCount));
  assert.ok(records.every((record) => record.ruleIds.includes("O24")));
  assert.ok(records.every((record) => record.ruleIds.includes("O27")));
  assert.ok(records.every((record) => record.ruleIds.includes("O64")));
  assert.ok(records.every((record) => record.ruleIds.includes("O68")));
  assert.ok(records.every((record) => record.rawSource && record.references.length === 1));

  const starred = records.find((record) => record.discipline === "Факультетская терапия, профессиональные болезни");
  assert.ok(starred);
  assert.ok(starred.ruleIds.includes("O31"));
  assert.ok(starred.ruleIds.includes("O66"));
  assert.ok(starred.ruleIds.includes("O58"));
  assert.ok(starred.ruleIds.includes("O67"));
  assert.equal(starred.structuralWeekday, null);
  assert.equal(starred.location, "БУЗОО «ККД», ул. Лермонтова,41");

  const mondayPediatrics = records.find((record) => record.discipline === "Педиатрия" && record.startTime === "11:00");
  assert.ok(mondayPediatrics);
  assert.ok(mondayPediatrics.ruleIds.includes("O72"));
  assert.deepEqual(mondayPediatrics.dates, ["2026-04-13", "2026-04-20", "2026-04-27"]);

  const fridaySurgery = records.find((record) => record.discipline === "Факультетская хирургия, урология" && record.dateExpression.includes(";"));
  assert.ok(fridaySurgery);
  assert.ok(fridaySurgery.ruleIds.includes("O61"));
  assert.deepEqual(fridaySurgery.dates, ["2026-04-10", "2026-04-17"]);
});

test("actual 4lek parser output passes the shared canonical publication preflight", async () => {
  const batch = buildCourseLectureListCanonicalBatch(await sourceText(), adapterOptions());
  assert.equal(batch.schedule.university_code, "omgmu");
  assert.equal(batch.schedule.group, "485");
  assert.equal(batch.schedule.parser, "omgmu-course-lecture-list/o01-o72");
  assert.equal(batch.events.length, 69);
  assert.ok(batch.events.every((event) => event.timing.time_mode === "floating"));
  assert.ok(batch.events.every((event) => event.source.file_hash === SOURCE_HASH));
  assert.ok(batch.events.every((event) => event.source.raw_text));
  assert.ok(batch.events.every((event) => event.parse.rule_ids.includes("O64")));

  let eventNo = 0;
  const prepared = prepareSchedulePublication(batch, {
    now: "2026-08-14T20:50:00.000Z",
    eventIdFactory: () => `evt_omgmu_4lek_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_4lek_1",
  });

  assert.equal(prepared.context.university, "omgmu");
  assert.equal(prepared.context.program, "medicine-international");
  assert.equal(prepared.context.groupCode, "485");
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal(prepared.diff.counts.added, 69);
  assert.equal(prepared.batch.events.length, 69);
  assert.match(prepared.ics, /DTSTART:20260406T080000/);
  assert.match(prepared.ics, /DTSTART:20260413T110000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
  assert.equal((prepared.ics.match(/BEGIN:VEVENT/g) || []).length, 69);
});

test("O27 count mismatch reaches canonical needs_review and blocks shared QA", () => {
  const badSource = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
ЛЕКЦИИ
ПОНЕДЕЛЬНИК
11.00-12.40 Педиатрия, 2 лекции: 13.04
`;
  const records = parseFourthCourseLectures(badSource);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "needs_review");
  assert.match(records[0].warnings[0], /O27/);

  const batch = buildCourseLectureListCanonicalBatch(badSource, adapterOptions());
  assert.equal(batch.events[0].parse.status, "needs_review");
  assert.throws(
    () => prepareSchedulePublication(batch),
    (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.stage === "input",
  );
});

test("course_lecture_list never falls back to a non-Russian source part", () => {
  const englishOnly = `
SCHEDULE CONDUCTED IN THE FORM OF CONTACT WORK
LECTURES
MONDAY
11.00-12.40 Pediatrics, 1 lecture: 13.04
`;
  assert.deepEqual(parseFourthCourseLectures(englishOnly), []);
  assert.throws(
    () => buildCourseLectureListCanonicalBatch(englishOnly, adapterOptions()),
    (error) => error.code === "OMG_COURSE_LECTURE_LIST_EMPTY",
  );
});
