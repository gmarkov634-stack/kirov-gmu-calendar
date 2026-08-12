import test from "node:test";
import assert from "node:assert/strict";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCycleWorkbook, isForeignCycleWorkbook } from "../src/adapters/kgmu/foreign-c-parser.mjs";

function letters(n) {
  let value = "";
  while (n > 0) { n -= 1; value = String.fromCharCode(65 + n % 26) + value; n = Math.floor(n / 26); }
  return value;
}
function ref(col, row) { return `${letters(col)}${row}`; }
function fixture() {
  const cells = [], merges = [], styledCells = [];
  const add = (row, col, value) => cells.push({ row, col, ref: ref(col, row), value });
  const merge = (row1, col1, row2, col2) => merges.push({
    ref: `${ref(col1, row1)}:${ref(col2, row2)}`,
    startRef: ref(col1, row1), endRef: ref(col2, row2),
    startRow: row1, endRow: row2, startCol: col1, endCol: col2,
  });
  add(7, 1, "2ND SEMESTER OF 2025-2026 ACADEMIC YEAR");
  const omitted = new Set(["2026-02-23", "2026-03-09", "2026-05-01", "2026-05-09"]);
  const dates = [];
  for (let d = new Date(Date.UTC(2026, 1, 2)); d <= new Date(Date.UTC(2026, 4, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && !omitted.has(iso)) dates.push(new Date(d));
  }
  const monthName = new Map([[1, "February"], [2, "March"], [3, "April"], [4, "May"]]);
  let col = 3;
  for (let month = 1; month <= 4; month += 1) {
    const monthDates = dates.filter((d) => d.getUTCMonth() === month);
    add(10, col, monthName.get(month));
    merge(10, col, 10, col + monthDates.length - 1);
    for (const d of monthDates) {
      add(11, col, d.getUTCDate());
      add(12, col, ["Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat"][d.getUTCDay()]);
      col += 1;
    }
  }
  assert.equal(col, 101);

  const fill = {
    "Faculty Therapy, Professional diseases": 2,
    Pediatrics: 3,
    Urology: 4,
    "Faculty Surgery": 5,
    Ophthalmology: 6,
    Otorhinolaryngology: 7,
    "Obstetrics and Gynecology": 8,
    "Neurology, Neurosurgery": 9,
    "Psychiatry, MP": 10,
  };
  const runs = {
    "401 i": [[3,18,"Faculty Therapy, Professional diseases"],[19,26,"Pediatrics"],[27,31,"Urology"],[32,35,"Faculty Surgery"],[37,41,"Ophthalmology"],[44,56,"Otorhinolaryngology"],[57,68,"Obstetrics and Gynecology"],[69,76,"Neurology, Neurosurgery"],[78,79,"Neurology, Neurosurgery"],[80,85,"Psychiatry, MP"]],
    "402 i": [[3,12,"Neurology, Neurosurgery"],[13,18,"Psychiatry, MP"],[19,34,"Faculty Therapy, Professional diseases"],[35,42,"Pediatrics"],[43,47,"Urology"],[48,51,"Faculty Surgery"],[52,56,"Ophthalmology"],[59,71,"Otorhinolaryngology"],[73,76,"Obstetrics and Gynecology"],[78,85,"Obstetrics and Gynecology"]],
    "403 i": [[3,14,"Obstetrics and Gynecology"],[15,24,"Neurology, Neurosurgery"],[27,32,"Psychiatry, MP"],[33,48,"Faculty Therapy, Professional diseases"],[49,56,"Pediatrics"],[57,61,"Urology"],[62,65,"Faculty Surgery"],[66,70,"Ophthalmology"],[71,76,"Otorhinolaryngology"],[78,85,"Otorhinolaryngology"]],
    "404 i": [[3,15,"Otorhinolaryngology"],[16,27,"Obstetrics and Gynecology"],[28,37,"Neurology, Neurosurgery"],[38,43,"Psychiatry, MP"],[45,60,"Faculty Therapy, Professional diseases"],[63,70,"Pediatrics"],[71,75,"Urology"],[76,76,"Faculty Surgery"],[78,80,"Faculty Surgery"],[81,85,"Ophthalmology"]],
    "405 i": [[3,7,"Urology"],[8,11,"Faculty Surgery"],[12,16,"Ophthalmology"],[17,29,"Otorhinolaryngology"],[30,41,"Obstetrics and Gynecology"],[42,51,"Neurology, Neurosurgery"],[52,57,"Psychiatry, MP"],[61,76,"Faculty Therapy, Professional diseases"],[78,85,"Pediatrics"]],
    "406 i": [[3,8,"Psychiatry, MP"],[9,16,"Pediatrics"],[17,21,"Urology"],[22,25,"Faculty Surgery"],[26,30,"Ophthalmology"],[31,43,"Otorhinolaryngology"],[45,56,"Obstetrics and Gynecology"],[57,66,"Neurology, Neurosurgery"],[69,76,"Faculty Therapy, Professional diseases"],[78,85,"Faculty Therapy, Professional diseases"]],
  };
  const anchors = {
    "401 i": {3:"Faculty Therapy, Professional diseases",19:"Pediatrics",27:"Urology",32:"Faculty Surgery",37:"Ophthalmology",44:"Otorhinolaryngology",57:"Obstetrics and Gynecology",70:"Neurology, Neurosurgery",80:"Psychiatry, MP"},
    "402 i": {3:"Neurology, Neurosurgery",13:"Psychiatry, MP",19:"Faculty Therapy, Professional diseases",35:"Pediatrics",43:"Urology",48:"Faculty Surgery",52:"Ophthalmology",59:"Otorhinolaryngology",73:"Obstetrics and Gynecology"},
    "403 i": {3:"Obstetrics and Gynecology",15:"Neurology, Neurosurgery",27:"Psychiatry, MP",33:"Faculty Therapy, Professional diseases",49:"Pediatrics",57:"Urology",62:"Faculty Surgery",66:"Ophthalmology",74:"Otorhinolaryngology"},
    "404 i": {3:"Otorhinolaryngology",16:"Obstetrics and Gynecology",28:"Neurology, Neurosurgery",38:"Psychiatry, MP",45:"Faculty Therapy, Professional diseases",63:"Pediatrics",71:"Urology",76:"Faculty Surgery",81:"Ophthalmology"},
    "405 i": {3:"Urology",8:"Faculty Surgery",12:"Ophthalmology",17:"Otorhinolaryngology",30:"Obstetrics and Gynecology",42:"Neurology, Neurosurgery",52:"Psychiatry, MP",61:"Faculty Therapy, Professional diseases",78:"Pediatrics"},
    "406 i": {3:"Psychiatry, MP",9:"Pediatrics",17:"Urology",22:"Faculty Surgery",26:"Ophthalmology",31:"Otorhinolaryngology",45:"Obstetrics and Gynecology",57:"Neurology, Neurosurgery",70:"Faculty Therapy, Professional diseases"},
  };
  let row = 13;
  for (const [group, groupRuns] of Object.entries(runs)) {
    add(row, 2, group);
    for (const [start, end, subject] of groupRuns) {
      for (let c = start; c <= end; c += 1) styledCells.push({ row, col: c, ref: ref(c, row), value: anchors[group][c] || "", styleId: fill[subject] + 10, fillId: fill[subject] });
    }
    for (const [anchorCol, subject] of Object.entries(anchors[group])) add(row, Number(anchorCol), subject);
    add(row, 89, "Exams");
    row += 1;
  }
  merge(13, 89, 18, 100);

  add(23, 3, "Academic discipline"); add(23, 21, "Form of assessment"); add(23, 27, "Department"); add(23, 42, "Place of practical training"); add(23, 68, "Address"); add(23, 76, "Timing of classes");
  add(24, 76, "1st part of the day"); add(24, 80, "2nd part of the day");
  const footer = [
    [25,"Faculty Therapy, Professional diseases","exam","of Faculty Therapy","Centre of Cardiology and Neurology","Ivan Popov St 41","","13.00-16.05"],
    [26,"Pediatrics","","of Propaedeutics of Children`s Diseases","Children`s Clinical Consultive Diagnostic Centre","Krasnoarmeyskaya St 43","","13.00-16.05"],
    [27,"Neurology, Neurosurgery","exam","of Neurology, Neurosurgery and Neurorehabilitation","Kirov Regional Clinical Hospital","Vorovskiy St 42","","13.00-16.05"],
    [28,"Ophthalmology","credit test","of Ophthalmology","Kirov Clinical Ophthalmological Hospital","Oktyabrskiy Av 10а","8.30-11.35",""],
    [29,"Psychiatry, Medical Psychology","","of Psychiatry","Kirov Regional Clinical Psychiatric Hospital","Ganino village","","13.00-16.05"],
    [30,"Obstetrics and Gynecology","credit test","of Obstetrics and Gynecology","Kirov Regional Clinical Perinatal Centre","Moskovskaya St 163","","13:00-16:55"],
    [31,"Otorhinolaryngology","credit test","of Hospital Surgery","Kirov Regional Clinical Hospital","Vorovskiy St 42","","12.00-15.05"],
    [32,"Faculty Surgery (module)","exam","of Faculty Surgery","Emergency Care Hospital","Sverdlov St 4","","12.00-15.05"],
    [33,"Urology (module)","","of Faculty Surgery","Emergency Care Hospital","Sverdlov St 4","","12.00-15.05"],
    [34,"Elective Discipline in Physical Culture and Sports","credit test","of Physical Culture","Kirov SMU, building 3, Sports and Fitness Centre","Vladimirskaya St 112","Четверг 05.02-21.05 9.00-10.30",""],
  ];
  for (const [r, discipline, assessment, department, base, address, shift1, shift2] of footer) {
    add(r, 3, discipline); if (assessment) add(r, 21, assessment); add(r, 27, department); add(r, 42, base); add(r, 68, address); if (shift1) add(r, 76, shift1); if (shift2) add(r, 80, shift2);
  }
  merge(32, 21, 33, 26);
  add(37, 2, "Lectures on the disciplines are published on the educational website of Kirov SMU");
  return { sheets: [{ name: "4 course English", cells, merges, styledCells }] };
}

test("C-FIO course 4 expands color-coded cycles without weakening fail-closed semantics", () => {
  const workbook = fixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C");
  assert.deepEqual(classification.features.groupCodes, ["401и","402и","403и","404и","405и","406и"]);
  assert.equal(isForeignCycleWorkbook(workbook), true);
  const result = parseKgmuForeignCycleWorkbook(workbook, { program: "foreign", course: 4, academicYear: "2025/26", semester: 2 });
  assert.equal(result.type, "C");
  assert.equal(result.profile, "C-FIO");
  assert.equal(result.qa.status, "PASS");
  assert.equal(result.qa.mainGridSubjectDays, 475);
  assert.deepEqual(result.qa.mainGridSubjectDaysByGroup, { "401и":79,"402и":79,"403и":80,"404и":79,"405и":79,"406и":79 });
  assert.equal(result.qa.physicalEducationEvents, 96);
  assert.equal(result.qa.eventCount, 571);
  assert.deepEqual(result.qa.groupCounts, { "401и":95,"402и":95,"403и":96,"404и":95,"405и":95,"406и":95 });
  assert.equal(result.qa.duplicateCount, 0);
  assert.equal(result.qa.allowedOverlaps.length, 6);
  assert.equal(result.qa.remainingOverlaps.length, 0);
  assert.deepEqual(result.qa.allowedOverlaps.map((item) => `${item.group}|${item.date}`), [
    "401и|2026-03-19","402и|2026-04-02","403и|2026-04-23","404и|2026-05-07","405и|2026-02-12","406и|2026-03-05",
  ]);

  const events = result.schedules.flatMap((schedule) => schedule.events.map((event) => ({ ...event, group: schedule.group.code })));
  const ent403 = events.filter((event) => event.group === "403и" && event.title === "Оториноларингология");
  assert.equal(ent403.length, 14);
  const neuro401 = events.filter((event) => event.group === "401и" && event.title === "Неврология, нейрохирургия").map((event) => event.start.slice(0, 10));
  assert.ok(neuro401.includes("2026-04-30"));
  assert.ok(!neuro401.includes("2026-05-02"));
  assert.ok(neuro401.includes("2026-05-04"));
  assert.ok(neuro401.includes("2026-05-05"));

  assert.deepEqual([...new Set(events.filter((event) => event.title === "Факультетская терапия, профессиональные болезни").map((event) => `${event.start.slice(11,16)}-${event.end.slice(11,16)}`))], ["13:00-16:05"]);
  assert.deepEqual([...new Set(events.filter((event) => event.title === "Офтальмология").map((event) => `${event.start.slice(11,16)}-${event.end.slice(11,16)}`))], ["08:30-11:35"]);
  assert.deepEqual([...new Set(events.filter((event) => event.title === "Оториноларингология").map((event) => `${event.start.slice(11,16)}-${event.end.slice(11,16)}`))], ["12:00-15:05"]);
  assert.deepEqual([...new Set(events.filter((event) => event.title === "Факультетская хирургия (раздел)").map((event) => event.assessment))], ["exam"]);
  assert.deepEqual([...new Set(events.filter((event) => event.title === "Урология (раздел)").map((event) => event.assessment))], ["exam"]);
  assert.ok(events.some((event) => event.group === "401и" && event.kind === "physical_education" && event.start === "2026-02-05T09:00:00+03:00" && event.end === "2026-02-05T10:30:00+03:00"));
  assert.equal(events.filter((event) => event.kind === "practice").length, 475);
  assert.equal(events.filter((event) => event.kind === "physical_education").length, 96);
  assert.equal(events.some((event) => event.kind === "lecture" || /ЛЕКЦ\./.test(event.title)), false);
  assert.equal(events.some((event) => /EXAM/i.test(event.title) || /ЗАЩИТА ПРОЕКТА/.test(event.title)), false);
});
