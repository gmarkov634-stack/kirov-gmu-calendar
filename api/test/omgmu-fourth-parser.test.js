import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFourthCourseSchedules,
  parseFourthCourseCycles,
  parseFourthCourseLectures,
} from "../src/adapters/omgmu/fourth-parser.mjs";

const lectures = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
ЛЕКЦИИ
ПОНЕДЕЛЬНИК
08.00-09.40 Неврология, медицинская генетика, нейрохирургия, 2 лекции: 06.04-13.04 – БУЗОО ОКБ, ул. Березовая,3
ВТОРНИК
11.20-13.00 Акушерство и гинекология, 1 лекция: 07.04 - БУЗОО КРД № 6, ул. Перелета,3
`;

const cycles = `
РАСПИСАНИЕ ЦИКЛОВЫХ ЗАНЯТИЙ
1 цикл
       Дисциплина                Время К.дн.             485                               486

      Факультетская              08.20-
    хирургия,урология            09.50;        29.05-16.06                        17.06-02.07
                                 10.00-
                                 11.30

        Педиатрия                12.50-
                                 14.20;                                           16.07-29.07
                                 14.30-
                                 16.00
`;

test("parses shared fourth-course lectures by weekday", () => {
  const records = parseFourthCourseLectures(lectures);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].dates, ["2026-04-06", "2026-04-13"]);
  assert.equal(records[0].location, "БУЗОО ОКБ, ул. Березовая,3");
});

test("parses separate fourth-course cycle columns", () => {
  const records = parseFourthCourseCycles(cycles);
  assert.equal(records["485"].length, 1);
  assert.equal(records["486"].length, 2);
  assert.equal(records["485"][0].discipline, "Факультетская хирургия,урология");
  assert.equal(records["485"][0].startTime, "08:20");
  assert.equal(records["485"][0].endTime, "11:30");
});

test("builds normalized schedules for groups 485 and 486", () => {
  const schedules = buildFourthCourseSchedules(lectures, cycles);
  assert.equal(schedules["485"].group.code, "485");
  assert.equal(schedules["486"].group.code, "486");
  assert.ok(schedules["485"].events.length > 2);
  assert.ok(schedules["486"].events.length > schedules["485"].events.length);
});
