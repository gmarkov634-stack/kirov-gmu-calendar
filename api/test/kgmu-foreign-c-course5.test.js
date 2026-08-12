import test from "node:test";
import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse5Workbook } from "../src/adapters/kgmu/foreign-c-course5-reviewed.mjs";
import { stageCWorkbook } from "../src/adapters/kgmu/c-pipeline.mjs";

function letters(n) {
  let value = "";
  while (n > 0) {
    n -= 1;
    value = String.fromCharCode(65 + n % 26) + value;
    n = Math.floor(n / 26);
  }
  return value;
}

function ref(col, row) {
  return `${letters(col)}${row}`;
}

function fixture() {
  const cells = [];
  const merges = [];
  const styledCells = [];
  const add = (row, col, value) => cells.push({ row, col, ref: ref(col, row), value });
  const merge = (row1, col1, row2, col2) => merges.push({
    ref: `${ref(col1, row1)}:${ref(col2, row2)}`,
    startRef: ref(col1, row1), endRef: ref(col2, row2),
    startRow: row1, endRow: row2, startCol: col1, endCol: col2,
  });

  add(7, 1, "ВТОРОЕ ПОЛУГОДИЕ 2025-2026 УЧЕБНОГО ГОДА");
  const dates = [];
  for (let d = new Date(Date.UTC(2026, 1, 2)); d <= new Date(Date.UTC(2026, 1, 17)); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0) dates.push(new Date(d));
  }
  assert.equal(dates.length, 14);
  const monthBlocks = [[3,5],[6,8],[9,11],[12,16]];
  for (const [start, end] of monthBlocks) {
    add(10, start, "Февраль");
    merge(10, start, 10, end);
  }
  dates.forEach((date, index) => {
    const col = 3 + index;
    add(11, col, date.getUTCDate());
    add(12, col, ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][date.getUTCDay()]);
  });

  const subjects = [
    { start: 3, end: 4, fill: 2, text: "Эндокринология" },
    { start: 5, end: 6, fill: 3, text: "Практика по НММ" },
    { start: 7, end: 7, fill: 4, text: "Русский язык как язык спец-ти" },
    { start: 8, end: 8, fill: 5, text: "ДИБ" },
    { start: 9, end: 9, fill: 6, text: "Госпитальная терапия (модуль)" },
    { start: 10, end: 10, fill: 7, text: "Педиатрия" },
    { start: 11, end: 11, fill: 8, text: "Инфекционные болезни" },
    { start: 12, end: 12, fill: 9, text: "Травматология и ортопедия" },
    { start: 13, end: 13, fill: 10, text: "Акушерство и гинекология" },
    { start: 14, end: 14, fill: 11, text: "Госпитальная хирургия" },
    { start: 15, end: 15, fill: 12, text: "Детская хирургия" },
  ];

  for (let offset = 0; offset < 6; offset += 1) {
    const row = 13 + offset;
    const group = `${501 + offset} И`;
    add(row, 2, group);
    for (const subject of subjects) {
      for (let col = subject.start; col <= subject.end; col += 1) {
        const starred = offset === 2 && col === subject.start && (subject.fill === 2 || subject.fill === 3);
        const value = col === subject.start ? `${subject.text}${starred ? "*" : ""}` : "";
        styledCells.push({ row, col, ref: ref(col, row), value, styleId: subject.fill + 20, fillId: subject.fill });
        if (value) add(row, col, value);
      }
    }
    add(row, 16, "Экзамены");
    styledCells.push({ row, col: 16, ref: ref(16, row), value: "Экзамены", styleId: 40, fillId: 20 });
  }

  add(22, 3, "Дисциплина");
  add(22, 19, "Форма промежуточной аттестации");
  add(22, 25, "Кафедра");
  add(22, 40, "База практической подготовки");
  add(22, 64, "Адрес");
  add(22, 72, "Время проведения занятий");
  add(23, 72, "1 смена");
  add(23, 76, "2 смена");

  const footer = [
    [24, "Русский язык как язык специальности", "Зачёт", "Кировский ГМУ", "ул. Красноармейская, 35", "501и, 502и, 503и 13.00-16.05; 504и 15.00-18.05 505и 10.00-13.05 506и 15.00-18.05", ""],
    [25, "Практика по неотложным медицинским манипуляциям", "Зачёт с оценкой", "Кировский ГМУ", "ул. Пролетарская, 38", "8.30-11.35", "13.30-16.35"],
    [26, "Госпитальная терапия (модуль)", "Зачёт", "КОКБ", "ул. Воровского, 42", "", "13.00-16.55"],
    [27, "Педиатрия", "Экзамен", "ДККДЦ", "ул. Красноармейская, 43", "", "13.00-16.55"],
    [28, "Детские инфекционные болезни (раздел)", "", "ИКБ", "ул. Ленина, 207", "", "13.00-16.05"],
    [29, "Инфекционные болезни", "Экзамен", "ИКБ", "ул. Ленина, 207", "", "13.00-16.55"],
    [30, "Травматология и ортопедия", "", "ЦТОН", "ул. Московская, 163а", "", "13.00-16.05"],
    [31, "Акушерство и гинекология", "Экзамен", "БСМП", "ул. Свердлова, 4", "", "13.00-16.55"],
    [32, "Госпитальная хирургия (модуль)", "", "КОКБ", "ул. Воровского, 42", "", "13.00-16.05"],
    [33, "Детская хирургия (модуль)", "", "КОДКБ", "ул. Менделеева, 16", "", "13.00-16.05"],
    [34, "Эндокринология", "Зачёт", "КОКБ", "ул. Воровского, 42", "9.00-12.55", "13.00-16.55"],
    [35, "Дисциплины по физической культуре и спорту", "Зачёт", "Кировский ГМУ", "ул. Карла Маркса, 112", "Пятница с 06.02 по 13.02 10.40-12.10", ""],
  ];
  for (const [row, discipline, assessment, base, address, first, second] of footer) {
    add(row, 3, discipline);
    if (assessment) add(row, 19, assessment);
    add(row, 25, `Кафедра ${row}`);
    add(row, 40, base);
    add(row, 64, address);
    if (first) add(row, 72, first);
    if (second) add(row, 76, second);
  }
  add(37, 2, "Лекции по дисциплинам размещены на образовательном сайте Кировского ГМУ");
  return { sheets: [{ name: "Леч иностранцы 5 курс", cells, merges, styledCells }] };
}

test("course 5 C-FIO parses Russian aliases, group times, starred first shifts and PE", () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C");
  assert.deepEqual(classification.features.groupCodes, ["501и", "502и", "503и", "504и", "505и", "506и"]);

  const parsed = parseKgmuForeignCourse5Workbook(workbook, {
    program: "foreign",
    course: 5,
    academicYear: "2025/26",
    semester: 2,
  });
  assert.equal(parsed.qa.status, "PASS");
  assert.equal(parsed.qa.mainGridSubjectDays, 78);
  assert.equal(parsed.qa.physicalEducationEvents, 12);
  assert.equal(parsed.qa.eventCount, 90);
  assert.deepEqual(parsed.qa.groupCounts, { "501и":15, "502и":15, "503и":15, "504и":15, "505и":15, "506и":15 });
  assert.equal(parsed.qa.duplicateCount, 0);
  assert.equal(parsed.qa.remainingOverlaps.length, 0);
  assert.equal(parsed.qa.starApplications.length, 2);

  const events = parsed.schedules.flatMap((schedule) => schedule.events.map((event) => ({ ...event, group: schedule.group.code })));
  const eventAt = (group, title, date) => events.find((event) => event.group === group && event.title === title && event.start.startsWith(date));
  assert.equal(eventAt("503и", "Эндокринология", "2026-02-02")?.start.slice(11, 16), "09:00");
  assert.equal(eventAt("503и", "Эндокринология", "2026-02-03")?.start.slice(11, 16), "13:00");
  assert.equal(eventAt("503и", "Практика по неотложным медицинским манипуляциям", "2026-02-04")?.start.slice(11, 16), "08:30");
  assert.equal(eventAt("503и", "Практика по неотложным медицинским манипуляциям", "2026-02-05")?.start.slice(11, 16), "13:30");
  assert.equal(eventAt("501и", "Эндокринология", "2026-02-02")?.start.slice(11, 16), "13:00");
  assert.equal(eventAt("505и", "Русский язык как язык специальности", "2026-02-06")?.start.slice(11, 16), "10:00");
  assert.ok(events.some((event) => event.title === "Детские инфекционные болезни (раздел)"));
  assert.ok(events.some((event) => event.title === "Дисциплины по физической культуре и спорту" && event.start === "2026-02-06T10:40:00+03:00"));
});

test("C pipeline routes foreign course 5 to C-FIO without changing ordinary C", async () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  let stored = null;
  const queue = {
    async storeNormalized(_sha, value) {
      stored = value;
      return "normalized/course5.json";
    },
  };
  const staged = await stageCWorkbook({
    workbook,
    queue,
    sourceSha256: "abc123",
    sourceKey: "raw/course5.xlsx",
    metadata: { program: "foreign", course: 5, filename: "course5.xlsx", academicYear: "2025/26", semester: 2 },
    period: { academicYear: "2025/26", semester: 2 },
    classification,
  });
  assert.equal(staged.parserProfile, "C-FIO");
  assert.equal(staged.qa.status, "PASS");
  assert.equal(staged.schedules.length, 6);
  assert.equal(stored.parserType, "C");
  assert.equal(stored.parserProfile, "C-FIO");
});
