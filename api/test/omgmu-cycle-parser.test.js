import assert from "node:assert/strict";
import test from "node:test";
import { buildFifthCourseSchedule, parseFifthCourseBlocks } from "../src/adapters/omgmu/cycle-parser.mjs";

const fixture = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
      Дисциплина                Время К.дн.             585

Психиатрия,медицинская           08.20-
                                          6     06.04-13.04 (лекции)
  психология.Основы              10.00
   профессиональной              10.40-
     коммуникации                         8     06.04-15.04 (циклы)
                                 13.50

                                 08.20-
                                          7     16.04-24.04 (лекции)
                                 10.00
Акушерство и гинекология
                                 10.40-
                                          12    16.04 -04.05 (циклы)
                                 13.50
`;

const continuationPageFixture = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
      Дисциплина                Время К.дн.             585

Психиатрия,медицинская           08.20-
                                          6     06.04-13.04 (лекции)
  психология                     10.00
                                 10.40-
                                          8     06.04-15.04 (циклы)
                                 13.50
\f
Инфекционные болезни             08.20-
                                          12    17.06-02.07 (лекции)
                                 10.00
                                 10.40-
                                          17    17.06-09.07 (циклы)
                                 13.50
`;

const controlBeforeTypeFixture = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
      Дисциплина                Время К.дн.             585

Госпитальная терапия,            10.40-
эндокринология                            11    24.07-07.08, зачет-07.08
                                 13.50
                                                     (циклы)
`;

test("parses fifth-course lecture and cycle blocks", () => {
  const blocks = parseFifthCourseBlocks(fixture);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].discipline, "Психиатрия,медицинская психология.Основы профессиональной коммуникации");
  assert.equal(blocks[0].kind, "lecture");
  assert.equal(blocks[0].startTime, "08:20");
  assert.equal(blocks[0].endTime, "10:00");
  assert.deepEqual(blocks[0].dates.slice(0, 2), ["2026-04-06", "2026-04-07"]);
});

test("keeps parsing a combined table continuation page without a repeated header row", () => {
  const blocks = parseFifthCourseBlocks(continuationPageFixture);
  const infectious = blocks.filter((block) => block.discipline === "Инфекционные болезни");
  assert.equal(infectious.length, 2);
  assert.deepEqual(infectious.map((block) => block.kind), ["lecture", "cycle"]);
  assert.deepEqual(infectious.map((block) => [block.startTime, block.endTime]), [
    ["08:20", "10:00"],
    ["10:40", "13:50"],
  ]);
});

test("keeps the cycle series when a final-day control fragment precedes the type marker", () => {
  const blocks = parseFifthCourseBlocks(controlBeforeTypeFixture);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].discipline, "Госпитальная терапия, эндокринология");
  assert.equal(blocks[0].kind, "cycle");
  assert.equal(blocks[0].controlDate, "2026-08-07");
  assert.equal(blocks[0].dates.length, 11);
  assert.deepEqual([blocks[0].startTime, blocks[0].endTime], ["10:40", "13:50"]);

  const schedule = buildFifthCourseSchedule(controlBeforeTypeFixture);
  const finalDay = schedule.events.filter((event) => event.start.startsWith("2026-08-07"));
  assert.equal(finalDay.length, 1);
  assert.equal(finalDay[0].sourceType, "control");
  assert.equal(finalDay[0].title, "ЗАЧЁТ — Госпитальная терапия, эндокринология");
});

test("builds normalized group 585 schedule and excludes weekends and holidays", () => {
  const schedule = buildFifthCourseSchedule(fixture);
  assert.equal(schedule.group.code, "585");
  assert.equal(schedule.timezone, "Asia/Omsk");
  assert.ok(schedule.events.length > 10);
  assert.ok(schedule.events.every((event) => event.start.endsWith("+06:00")));
  assert.ok(!schedule.events.some((event) => event.start.startsWith("2026-05-01")));
});
