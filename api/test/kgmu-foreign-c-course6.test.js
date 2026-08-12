import test from "node:test";
import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCourse6Workbook } from "../src/adapters/kgmu/foreign-c-course6-reviewed.mjs";
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
function ref(col, row) { return `${letters(col)}${row}`; }

function fixture({ english = false, include606 = false } = {}) {
  const cells = [], merges = [], styledCells = [];
  const add = (row, col, value) => cells.push({ row, col, ref: ref(col, row), value });
  const merge = (row1, col1, row2, col2) => merges.push({ ref: `${ref(col1,row1)}:${ref(col2,row2)}`, startRef: ref(col1,row1), endRef: ref(col2,row2), startRow: row1, endRow: row2, startCol: col1, endCol: col2 });
  const style = (row, col, fillId, value = "") => styledCells.push({ row, col, ref: ref(col,row), fillId, styleId: fillId + 100, value });

  add(7, 1, english ? "2ND SEMESTER OF 2025-2026 ACADEMIC YEAR" : "ВТОРОЕ ПОЛУГОДИЕ 2025-2026 УЧЕБНОГО ГОДА");
  add(10, 3, english ? "February" : "Февраль"); merge(10, 3, 10, 16);
  for (let index = 0; index < 14; index += 1) {
    add(11, 3 + index, 2 + index);
    add(12, 3 + index, ["Mon","Tue","Wed","Thu","Fri","Sat","Mon","Tue","Wed","Thu","Fri","Sat","Mon","Tue"][index]);
  }

  const subjects = english ? [
    [3,4,2,"Polyclinic Therapy"], [5,5,3,"Hospital Therapy"], [6,6,4,"Phthisiology"],
    [7,7,5,"Hematology"], [8,8,6,"Clinical Immunology and Allergology"], [9,9,7,"ESC"],
    [10,11,8,"Oncology, Radiology Therapy"], [12,13,9,"Elective discipline"],
  ] : [
    [3,4,2,"Поликлиническая терапия"], [5,5,3,"Госпитальная терапия"], [6,6,4,"Фтизиатрия"],
    [7,7,5,"Гематология"], [8,8,6,"Клин.иммунлогия и аллергология"], [9,9,7,"ОСК"],
    [10,11,8,"Онкология, лучевая терапия"], [12,13,9,"Электив"],
  ];
  const groupCount = include606 ? 6 : 5;
  for (let i = 0; i < groupCount; i += 1) {
    const row = 14 + i;
    const code = 601 + i;
    add(row, 2, `${code}${english ? "i" : "и"}`);
    for (const [start,end,fill,text] of subjects) {
      for (let col = start; col <= end; col += 1) {
        const value = col === start ? text : "";
        style(row, col, fill, value);
        if (value) add(row, col, value);
      }
    }
    add(row, 14, english ? "Exam" : "Экзамен"); style(row, 14, 2, english ? "Exam" : "Экзамен");
    add(row, 15, english ? "Individual work" : "СР"); style(row, 15, 10, english ? "Individual work" : "СР");
    add(row, 16, english ? "Final State Examination" : "ГИА"); style(row, 16, 11, english ? "Final State Examination" : "ГИА");
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
    [33,"Elective disciplines Б1.В.ДВ.04.","Credit test","9.00-13.40"], [34,"Current Issues of Perinatology","Credit test","9.00-13.40"],
  ] : [
    [24,"Поликлиническая терапия","Экзамен","8.00-12.40"], [25,"Госпитальная терапия (модуль)","Экзамен","13.30-18.10"], [26,"Фтизиатрия","Экзамен","8.00-12.40"],
    [27,"Онкология, лучевая терапия","Зачёт","8.00-11.05 три дня 8.00-12.40"], [28,"Гематология","Зачёт","8.30-13.10"],
    [29,"Клиническая иммунология и аллергология","Зачёт","13.00-17.40"], [30,"Обучающий симуляционный курс (ОСК)","Зачёт","11.40-14.45"],
    [31,"Элективные дисциплины Б1.В.ДВ.05.","Зачёт","13.00-17.40"], [32,"Клиническая биохимия","Зачёт","13.00-17.40"],
    [33,"Элективные дисциплины Б1.В.ДВ.04.","Зачёт","9.00-13.40"], [34,"Актуальные вопросы перинатологии","Зачёт","9.00-13.40"],
  ];
  for (const [row, discipline, assessment, time] of footer) {
    add(row,3,discipline); add(row,19,assessment); add(row,25,`Dept ${row}`); add(row,40,`Base ${row}`); add(row,64,`Address ${row}`); add(row,76,time);
  }
  return { sheets: [{ name: english ? "6-th year FFS" : "6 курс ФИО", cells, merges, styledCells }] };
}

test("course 6 C-FIO keeps deterministic events and fails closed on oncology/electives", () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C");
  const parsed = parseKgmuForeignCourse6Workbook(workbook, { program:"foreign", course:6, academicYear:"2025/26", semester:2 });
  assert.equal(parsed.qa.status, "REVIEW_REQUIRED");
  assert.deepEqual(parsed.qa.primaryGroups, ["601и","602и","603и","604и","605и"]);
  assert.equal(parsed.qa.deterministicMainGridEvents, 35);
  assert.deepEqual(parsed.qa.deterministicMainGridEventsByGroup, { "601и":7,"602и":7,"603и":7,"604и":7,"605и":7 });
  assert.equal(parsed.qa.ambiguousOncologyLongDays.length, 5);
  assert.equal(parsed.qa.ambiguousElectiveAssignments.length, 5);
  assert.equal(parsed.qa.examInterruptions.length, 5);
  assert.equal(parsed.qa.mirrorSemanticRisks.length, 0);
  assert.equal(parsed.qa.unhandledBlocks.length, 0);
  assert.equal(parsed.qa.missingTimes.length, 0);
  assert.equal(parsed.qa.duplicateCount, 0);
  assert.equal(parsed.qa.remainingOverlaps.length, 0);
  assert.equal(parsed.qa.eventCount, 35);
  assert.ok(parsed.schedules.every((schedule) => schedule.events.every((event) => !/Онкология|Электив/i.test(event.title))));
});

test("course 6 English mirror does not auto-add extra 606i", () => {
  const parsed = parseKgmuForeignCourse6Workbook(fixture({ english:true, include606:true }), { program:"foreign", course:6, academicYear:"2025/26", semester:2 });
  assert.equal(parsed.qa.status, "REVIEW_REQUIRED");
  assert.deepEqual(parsed.qa.sourceGroups, ["601и","602и","603и","604и","605и","606и"]);
  assert.deepEqual(parsed.schedules.map((schedule) => schedule.group.code), ["601и","602и","603и","604и","605и"]);
  assert.deepEqual(parsed.qa.mirrorSemanticRisks[0]?.extraGroups, ["606и"]);
});

test("C pipeline stages course 6 as non-publishable C-FIO review", async () => {
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
  assert.equal(staged.qa.status, "REVIEW_REQUIRED");
  assert.equal(staged.schedules.length, 5);
  assert.equal(stored.qa.status, "REVIEW_REQUIRED");
});
