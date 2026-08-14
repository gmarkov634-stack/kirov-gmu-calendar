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

const multilineLectures = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
ЛЕКЦИИ
*08.20-10.00 Факультетская терапия, профессиональные болезни, 11 лекций: 07.05-21.05 (без субботы)
- БУЗОО «ККД», ул. Лермонтова, 41
ЧЕТВЕРГ
11.20-13.00 Инфекционные болезни у детей, 4 лекции: 09.04-30.04 - БУЗОО «ДКБ № 3», инф.
стационар, ул. 19 Партсъезда, 16
`;

const irregularHyphenLectures = `
РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ
ЛЕКЦИИ
ПОНЕДЕЛЬНИК
10.20-12.00 Факультетская хирургия, урология, 1 лекция: 04.05- БУЗОО«ОКБ»,ул.Березовая,3
ВТОРНИК
11.20-13.00 Акушерство и гинекология, 4 лекции:07.04-28.04- БУЗОО «КРД № 6»,ул. Перелета,3
СРЕДА
08.20-10.00 Факультетская хирургия, урология, 5 лекций:08.04 - 06.05-БУЗОО«ОКБ»,ул.Березовая,3
ЧЕТВЕРГ
11.20-13.00 Инфекционные болезни у детей, 4 лекции:09.04-30.04-БУЗОО «ГДКБ № 3», инф. стационар, ул.19 Партсъезда,16
ПЯТНИЦА
08.20-10.00 Факультетская хирургия, урология, 2 лекции: 10.04; 17.04-БУЗОО«ОКБ»,ул.Березовая,3
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

test("keeps physical continuation lines inside one lecture record", () => {
  const records = parseFourthCourseLectures(multilineLectures);
  assert.equal(records.length, 2);
  assert.equal(records[0].discipline, "Факультетская терапия, профессиональные болезни");
  assert.equal(records[0].location, "БУЗОО «ККД», ул. Лермонтова, 41");
  assert.equal(records[1].discipline, "Инфекционные болезни у детей");
  assert.equal(records[1].location, "БУЗОО «ДКБ № 3», инф. стационар, ул. 19 Партсъезда, 16");
});

test("separates lecture locations after hyphens regardless of surrounding spaces", () => {
  const records = parseFourthCourseLectures(irregularHyphenLectures);
  assert.equal(records.length, 5);
  assert.deepEqual(records.map((record) => record.dates.length), [1, 4, 5, 4, 2]);
  assert.deepEqual(records.map((record) => record.location), [
    "БУЗОО«ОКБ»,ул.Березовая,3",
    "БУЗОО «КРД № 6»,ул. Перелета,3",
    "БУЗОО«ОКБ»,ул.Березовая,3",
    "БУЗОО «ГДКБ № 3», инф. стационар, ул.19 Партсъезда,16",
    "БУЗОО«ОКБ»,ул.Березовая,3",
  ]);
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
