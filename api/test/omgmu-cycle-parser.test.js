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

test("parses fifth-course lecture and cycle blocks", () => {
  const blocks = parseFifthCourseBlocks(fixture);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].discipline, "Психиатрия,медицинская психология.Основы профессиональной коммуникации");
  assert.equal(blocks[0].kind, "lecture");
  assert.equal(blocks[0].startTime, "08:20");
  assert.equal(blocks[0].endTime, "10:00");
  assert.deepEqual(blocks[0].dates.slice(0, 2), ["2026-04-06", "2026-04-07"]);
});

test("builds normalized group 585 schedule and excludes weekends and holidays", () => {
  const schedule = buildFifthCourseSchedule(fixture);
  assert.equal(schedule.group.code, "585");
  assert.equal(schedule.timezone, "Asia/Omsk");
  assert.ok(schedule.events.length > 10);
  assert.ok(schedule.events.every((event) => event.start.endsWith("+06:00")));
  assert.ok(!schedule.events.some((event) => event.start.startsWith("2026-05-01")));
});
