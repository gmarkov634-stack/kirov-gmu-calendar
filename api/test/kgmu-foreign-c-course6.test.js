import test from "node:test";
import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse6Workbook } from "../src/adapters/kgmu/foreign-c-course6-reviewed.mjs";
import { stageCWorkbook } from "../src/adapters/kgmu/c-pipeline.mjs";
import { buildCalendar } from "../src/calendar.js";

function letters(n) {
  let value = "";
  while (n > 0) {
    n -= 1;
    value = String.fromCharCode(65 + n % 26) + value;
    n = Math.floor(n / 26);
  }
  return value;
}
function ref(col, row) { return `${letters(col)}${row}`; }

function fixture({ english = false, hidden606 = false } = {}) {
  const cells = [], merges = [], styledCells = [];
  const add = (row, col, value) => cells.push({ row, col, ref: ref(col, row), value });
  const merge = (row1, col1, row2, col2) => merges.push({ ref: `${ref(col1,row1)}:${ref(col2,row2)}`, startRef: ref(col1,row1), endRef: ref(col2,row2), startRow: row1, endRow: row2, startCol: col1, endCol: col2 });
  const style = (row, col, fillId, value = "") => styledCells.push({ row, col, ref: ref(col,row), fillId, styleId: fillId + 100, value });

  add(7, 1, english ? "2ND SEMESTER OF 2025-2026 ACADEMIC YEAR" : "ВТОРОЕ ПОЛУГОДИЕ 2025-2026 УЧЕБНОГО ГОДА");
  merge(5, 1, 5, 4); merge(6, 1, 6, 4); merge(8, 1, 8, 4);
  add(10, 3, english ? "February" : "Февраль"); merge(10, 3, 10, 20);
  for (let index = 0; index < 18; index += 1) {
    add(11, 3 + index, 2 + index);
    add(12, 3 + index, ["Mon","Tue","Wed","Thu","Fri","Sat"][index % 6]);
  }

  const groupCount = hidden606 ? 6 : 5;
  for (let i = 0; i < groupCount; i += 1) {
    const row = 14 + i;
    const code = 601 + i;
    add(row, 2, `${code}${english ? "i" : "и"}`);
    const blocks = english ? [
      [3,4,2,"Polyclinic Therapy"], [6,6,3,"Hospital Therapy"], [7,7,4,"Phthisiology"],
      [8,8,5,"Hematology"], [9,9,6,"Clinical Immunology and Allergology"], [10,10,7,"ESC"],
      [11,14,8,"Oncology, Radiology Therapy"], [15,16,9,"Elective discipline"],
    ] : [
      [3,4,2,"Поликлиническая терапия"], [6,6,3,"Госпитальная терапия"], [7,7,4,"Фтизиатрия"],
      [8,8,5,"Гематология"], [9,9,6,"Клин.иммунлогия и аллергология"], [10,10,7,"ОСК"],
      [11,14,8,"Онкология, лучевая терапия"], [15,16,9,"Электив"],
    ];
    for (const [start,end,fill,text] of blocks) {
      for (let col = start; col <= end; col += 1) {
        const value = col === start ? text : "";
        style(row, col, fill, value);
        if (value) add(row, col, value);
      }
    }
    add(row, 5, english ? "Exam" : "Экзамен"); style(row, 5, 2, english ? "Exam" : "Экзамен");
    add(row, 17, english ? "Individual work" : "СР"); style(row, 17, 10, english ? "Individual work" : "СР");
    add(row, 18, english ? "Final State Examination" : "ГИА"); style(row, 18, 11, english ? "Final State Examination" : "ГИА");
    style(row, 19, 11); style(row, 20, 11);
  }

  const H = english ? {
    discipline:"Academic discipline", assessment:"Form of assessment", department:"Department", base:"Place of practical training", address:"Address", s1:"1st part of the day", s2:"2nd part of the day",
  } : {
    discipline:"Дисциплина", assessment:"Форма промежуточной аттестации", department:"Кафедра", base:"База практической подготовки", address:"Адрес", s1:"1 смена", s2:"2 смена",
  };
  add(22,3,H.discipline); add(22,19,H.assessment); add(22,25,H.department); add(22,40,H.base); add(22,64,H.address); add(22,72,"Время проведения занятий");
  add(23,72,H.s1); add(23,76,H.s2);
  const footer = english ? [
    [24,"Polyclinic Therapy","Exam","8.00-12.40"], [25,"Hospital Therapy (module)","Exam","13.30-18.10"], [26,"Phthisiology","Exam","8.00-12.40"],
    [27,"Oncology, Radiology Therapy","Credit test","8.00-11.05; three days 8.00-12.40"], [28,"Hematology","Credit test","8.30-13.10"],
    [29,"Clinical Immunology and Allergology","Credit test","13.00-17.40"], [30,"Educational Simulation Course (ESC)","Credit test","11.40-14.45"],
    [31,"Elective disciplines Б1.В.ДВ.05.","Credit test","13.00-17.40"], [32,"Clinical Biochemistry","Credit test","13.00-17.40"],
  ] : [
    [24,"Поликлиническая терапия","Экзамен","8.00-12.40"], [25,"Госпитальная терапия (модуль)","Экзамен","13.30-18.10"], [26,"Фтизиатрия","Экзамен","8.00-12.40"],
    [27,"Онкология, лучевая терапия","Зачёт","8.00-11.05 три дня 8.00-12.40"], [28,"Гематология","Зачёт","8.30-13.10"],
    [29,"Клиническая иммунология и аллергология","Зачёт","13.00-17.40"], [30,"Обучающий симуляционный курс (ОСК)","Зачёт","11.40-14.45"],
    [31,"Элективные дисциплины Б1.В.ДВ.05.","Зачёт","13.00-17.40"], [32,"Клиническая биохимия","Зачёт","13.00-17.40"],
  ];
  for (const [row, discipline, assessment, time] of footer) {
    add(row,3,discipline); add(row,19,assessment); add(row,25,`Dept ${row}`); add(row,40,`Base ${row}`); add(row,64,`Address ${row}`); add(row,76,time);
  }
  return { sheets: [{ name: english ? "6-th year FFS" : "6 курс ФИО", cells, merges, styledCells, hiddenRows: hidden606 ? [19] : [] }] };
}

test("course 6 C-FIO applies confirmed oncology, elective, exam and GIA rules", () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C");
  const parsed = parseKgmuForeignCourse6Workbook(workbook, { program:"foreign", course:6, academicYear:"2025/26", semester:2 });
  assert.equal(parsed.qa.status, "PASS");
  assert.deepEqual(parsed.qa.primaryGroups, ["601и","602и","603и","604и","605и"]);
  assert.equal(parsed.qa.deterministicMainGridEvents, 35);
  assert.equal(parsed.qa.normalizedOncologyDays, 20);
  assert.equal(parsed.qa.normalizedOncologyLongDays, 15);
  assert.equal(parsed.qa.electiveAllDayEvents, 10);
  assert.equal(parsed.qa.examEvents, 5);
  assert.equal(parsed.qa.giaEvents, 5);
  assert.equal(parsed.qa.ambiguousOncologyLongDays.length, 0);
  assert.equal(parsed.qa.ambiguousElectiveAssignments.length, 0);
  assert.equal(parsed.qa.unresolvedConfirmedRules.length, 0);
  assert.equal(parsed.qa.eventCount, 75);
  assert.deepEqual(parsed.qa.groupCounts, { "601и":15,"602и":15,"603и":15,"604и":15,"605и":15 });

  const events = parsed.schedules[0].events;
  const oncology = events.filter((event) => event.title === "Онкология, лучевая терапия");
  assert.equal(oncology.length, 4);
  assert.ok(oncology.slice(0, 3).every((event) => event.end.includes("12:40:00")));
  assert.ok(oncology[3].end.includes("11:05:00"));
  const elective = events.filter((event) => event.title === "ЭЛЕКТИВНАЯ ДИСЦИПЛИНА");
  assert.equal(elective.length, 2);
  assert.ok(elective.every((event) => event.allDay === true));
  const exam = events.find((event) => event.kind === "exam");
  assert.equal(exam.title, "ЭКЗАМЕН — Поликлиническая терапия");
  assert.ok(exam.start.includes("08:00:00"));
  assert.ok(exam.end.includes("12:40:00"));
  const gia = events.find((event) => event.kind === "state_exam");
  assert.equal(gia.title, "ГИА");
  assert.equal(gia.allDay, true);
});

test("hidden 606i does not participate in classification or course 6 parsing", () => {
  const workbook = fixture({ english:true, hidden606:true });
  const classification = classifyKgmuWorkbook(workbook);
  assert.deepEqual(classification.features.groupCodes, ["601и","602и","603и","604и","605и"]);
  const parsed = parseKgmuForeignCourse6Workbook(workbook, { program:"foreign", course:6, academicYear:"2025/26", semester:2 });
  assert.equal(parsed.qa.status, "PASS");
  assert.deepEqual(parsed.qa.sourceGroups, ["601и","602и","603и","604и","605и"]);
  assert.deepEqual(parsed.schedules.map((schedule) => schedule.group.code), ["601и","602и","603и","604и","605и"]);
  assert.equal(parsed.qa.mirrorSemanticRisks.length, 0);
});

test("C pipeline stages confirmed course 6 as publishable C-FIO", async () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  let stored = null;
  const queue = { async storeNormalized(_sha, value) { stored = value; return "normalized/course6.json"; } };
  const staged = await stageCWorkbook({
    workbook, queue, sourceSha256:"course6sha", sourceKey:"raw/course6.xlsx",
    metadata:{ program:"foreign", course:6, filename:"course6.xlsx", academicYear:"2025/26", semester:2 },
    period:{ academicYear:"2025/26", semester:2 }, classification,
  });
  assert.equal(staged.parserProfile, "C-FIO");
  assert.equal(staged.qa.status, "PASS");
  assert.equal(staged.schedules.length, 5);
  assert.equal(stored.qa.status, "PASS");
});

test("ICS emits elective and GIA as VALUE=DATE all-day events", () => {
  const parsed = parseKgmuForeignCourse6Workbook(fixture(), { program:"foreign", course:6, academicYear:"2025/26", semester:2 });
  const ics = buildCalendar(parsed.schedules[0]);
  assert.match(ics, /SUMMARY:ЭЛЕКТИВНАЯ ДИСЦИПЛИНА/);
  assert.match(ics, /SUMMARY:ГИА/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}/);
  assert.match(ics, /DTEND;VALUE=DATE:\d{8}/);
});
