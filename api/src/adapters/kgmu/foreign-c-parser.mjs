import { createHash } from "node:crypto";

const MONTHS = new Map([
  ["январ", 1], ["january", 1], ["jan", 1],
  ["феврал", 2], ["february", 2], ["feb", 2],
  ["март", 3], ["march", 3], ["mar", 3],
  ["апрел", 4], ["april", 4], ["apr", 4],
  ["май", 5], ["мая", 5], ["may", 5],
  ["июн", 6], ["june", 6], ["jun", 6],
  ["июл", 7], ["july", 7], ["jul", 7],
  ["август", 8], ["august", 8], ["aug", 8],
  ["сентябр", 9], ["september", 9], ["sep", 9],
  ["октябр", 10], ["october", 10], ["oct", 10],
  ["ноябр", 11], ["november", 11], ["nov", 11],
  ["декабр", 12], ["december", 12], ["dec", 12],
]);
const WEEKDAYS = new Map([
  ["пн", 1], ["понедельник", 1], ["mon", 1], ["monday", 1],
  ["вт", 2], ["вторник", 2], ["tue", 2], ["tues", 2], ["tuesday", 2],
  ["ср", 3], ["среда", 3], ["wed", 3], ["wednesday", 3],
  ["чт", 4], ["четверг", 4], ["thu", 4], ["thur", 4], ["thurs", 4], ["thursday", 4],
  ["пт", 5], ["пятница", 5], ["fri", 5], ["friday", 5],
  ["сб", 6], ["суббота", 6], ["sat", 6], ["saturday", 6],
]);

const SUBJECTS = [
  { patterns: [/^faculty therapy,?\s*professional diseases$/i], footer: /^faculty therapy,?\s*professional diseases$/i, title: "Факультетская терапия, профессиональные болезни" },
  { patterns: [/^pediatrics$/i], footer: /^pediatrics$/i, title: "Педиатрия" },
  { patterns: [/^urology$/i, /^urology \(module\)$/i], footer: /^urology \(module\)$/i, title: "Урология (раздел)" },
  { patterns: [/^faculty surgery$/i, /^faculty surgery \(module\)$/i], footer: /^faculty surgery \(module\)$/i, title: "Факультетская хирургия (раздел)" },
  { patterns: [/^ophthalmology$/i], footer: /^ophthalmology$/i, title: "Офтальмология" },
  { patterns: [/^otorhinolaryngology$/i], footer: /^otorhinolaryngology$/i, title: "Оториноларингология" },
  { patterns: [/^obstetrics and gynecology$/i], footer: /^obstetrics and gynecology$/i, title: "Акушерство и гинекология" },
  { patterns: [/^neurology,?\s*neurosurgery$/i], footer: /^neurology,?\s*neurosurgery$/i, title: "Неврология, нейрохирургия" },
  { patterns: [/^psychiatry,?\s*mp$/i, /^psychiatry,?\s*medical psychology$/i], footer: /^psychiatry,?\s*medical psychology$/i, title: "Психиатрия, медицинская психология" },
];

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}

function monthNumber(value) {
  const text = clean(value).toLowerCase();
  for (const [name, number] of MONTHS) if (text.includes(name)) return number;
  return null;
}

function normalizedAcademicYear(value) {
  const match = String(value || "").match(/(20\d{2})\D+(\d{2,4})/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  return end === start + 1 ? { start, end, label: `${start}/${String(end).slice(-2)}` } : null;
}

function workbookText(workbook) {
  return (workbook?.sheets || []).flatMap((sheet) => sheet.cells || []).map((cell) => clean(cell.value)).join("\n");
}

function resolvePeriod(workbook, metadata = {}) {
  const text = workbookText(workbook);
  const academicYear = normalizedAcademicYear(metadata.academicYear) || normalizedAcademicYear(text);
  let semester = [1, 2].includes(Number(metadata.semester)) ? Number(metadata.semester) : null;
  if (!semester) {
    if (/2(?:nd)?\s+(?:semester|half)|second\s+(?:semester|half)/i.test(text) || /втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(text)) semester = 2;
    if (/1(?:st)?\s+(?:semester|half)|first\s+(?:semester|half)/i.test(text) || /перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(text)) semester = 1;
  }
  if (!academicYear || !semester) {
    const error = new Error("Cannot resolve academic year/semester from KGMU C-FIO workbook");
    error.code = "KGMU_CFIO_PERIOD_UNKNOWN";
    throw error;
  }
  return { academicYear, semester, eventYear: semester === 1 ? academicYear.start : academicYear.end };
}

function byRows(sheet) {
  const result = new Map();
  for (const cell of sheet.cells || []) {
    if (!result.has(cell.row)) result.set(cell.row, []);
    result.get(cell.row).push(cell);
  }
  return result;
}

function cellMap(sheet) {
  return new Map((sheet.cells || []).map((cell) => [cell.ref, cell]));
}

function mergeAt(sheet, col, row) {
  return (sheet.merges || []).find((merge) => merge.startCol <= col && col <= merge.endCol && merge.startRow <= row && row <= merge.endRow) || null;
}

function ref(col, row) {
  let n = col;
  let letters = "";
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(65 + n % 26) + letters;
    n = Math.floor(n / 26);
  }
  return `${letters}${row}`;
}

function effectiveValue(sheet, cells, col, row) {
  const direct = cells.get(ref(col, row));
  if (direct) return direct.value;
  const merge = mergeAt(sheet, col, row);
  if (!merge) return "";
  return cells.get(merge.startRef)?.value ?? "";
}

function findCycleSheet(workbook) {
  for (const sheet of workbook?.sheets || []) {
    const rows = byRows(sheet);
    const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
      const n = Number(cell.value);
      return Number.isInteger(n) && n >= 1 && n <= 31;
    }).length >= 10)?.[0];
    const foreignGroups = [...rows.values()].flat().filter((cell) => groupCode(cell.value)).length;
    if (dateRow && foreignGroups >= 4) return { sheet, rows, dateRow };
  }
  const error = new Error("C-FIO calendar grid was not found");
  error.code = "KGMU_CFIO_GRID_NOT_FOUND";
  throw error;
}

function dateColumns(sheet, rows, dateRow, year) {
  const monthRows = [...rows.entries()].filter(([row]) => row < dateRow && row >= dateRow - 3).sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) throw Object.assign(new Error("C-FIO month header was not found"), { code: "KGMU_CFIO_MONTH_HEADER_NOT_FOUND" });
  const monthStarts = (rows.get(monthRow) || []).map((cell) => ({ col: cell.col, month: monthNumber(cell.value) })).filter((item) => item.month).sort((a, b) => a.col - b.col);
  const result = new Map();
  for (const cell of rows.get(dateRow) || []) {
    const day = Number(cell.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const month = [...monthStarts].reverse().find((item) => item.col <= cell.col)?.month;
    if (!month) continue;
    result.set(cell.col, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return result;
}

function footerColumns(rows) {
  for (const [row, cells] of rows) {
    const discipline = cells.find((cell) => /^(academic\s+)?discipline$/i.test(clean(cell.value)))?.col;
    if (!discipline) continue;
    const sub = rows.get(row + 1) || [];
    return {
      headerRow: row,
      discipline,
      assessment: cells.find((cell) => /form of assessment/i.test(clean(cell.value)))?.col,
      department: cells.find((cell) => /^department$/i.test(clean(cell.value)))?.col,
      base: cells.find((cell) => /place of practical training/i.test(clean(cell.value)))?.col,
      address: cells.find((cell) => /^address$/i.test(clean(cell.value)))?.col,
      shift1: sub.find((cell) => /1st\s+part of the day/i.test(clean(cell.value)))?.col,
      shift2: sub.find((cell) => /2nd\s+part of the day/i.test(clean(cell.value)))?.col,
    };
  }
  throw Object.assign(new Error("C-FIO footer reference table was not found"), { code: "KGMU_CFIO_FOOTER_NOT_FOUND" });
}

function footerRows(sheet, rows, columns) {
  const cells = cellMap(sheet);
  const maxRow = Math.max(...rows.keys());
  const result = [];
  for (let row = columns.headerRow + 2; row <= maxRow; row += 1) {
    const discipline = clean(effectiveValue(sheet, cells, columns.discipline, row));
    if (!discipline || /lectures on the disciplines/i.test(discipline)) continue;
    result.push({
      row,
      discipline,
      assessment: columns.assessment ? clean(effectiveValue(sheet, cells, columns.assessment, row)) || null : null,
      department: columns.department ? clean(effectiveValue(sheet, cells, columns.department, row)) : "",
      base: columns.base ? clean(effectiveValue(sheet, cells, columns.base, row)) : "",
      address: columns.address ? clean(effectiveValue(sheet, cells, columns.address, row)) : "",
      shift1: columns.shift1 ? clean(effectiveValue(sheet, cells, columns.shift1, row)) : "",
      shift2: columns.shift2 ? clean(effectiveValue(sheet, cells, columns.shift2, row)) : "",
    });
  }
  return result;
}

function parseTime(value) {
  for (const match of String(value || "").matchAll(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/g)) {
    const sh = Number(match[1]), sm = Number(match[2]), eh = Number(match[3]), em = Number(match[4]);
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) continue;
    const duration = eh * 60 + em - (sh * 60 + sm);
    if (duration <= 0 || duration > 360) continue;
    return { start: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`, end: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}` };
  }
  return null;
}

function subjectDescriptor(text, footer) {
  const value = clean(text);
  const def = SUBJECTS.find((item) => item.patterns.some((pattern) => pattern.test(value)));
  if (!def) return null;
  const row = footer.find((item) => def.footer.test(item.discipline));
  if (!row) return null;
  return { ...def, footer: row };
}

function stableId(group, date, start, title, source) {
  const hash = createHash("sha1").update([group, date, start, title, source].join("|")).digest("hex").slice(0, 12);
  return `kgmu-${group}-${date}-${start.replace(":", "")}-${hash}`;
}

function location(row) {
  return [row.base, row.address].filter(Boolean).join(", ");
}

function timeForPractice(descriptor, rawCellText) {
  const first = parseTime(descriptor.footer.shift1);
  const second = parseTime(descriptor.footer.shift2);
  if (first && !second) return first;
  if (!first && second) return second;
  if (first && second) return clean(rawCellText).includes("*") ? second : first;
  return null;
}

function event(group, date, time, descriptor, extra = {}) {
  const source = extra.source || "main_grid";
  return {
    id: stableId(group, date, time.start, descriptor.title, source),
    group,
    title: descriptor.title,
    discipline: descriptor.title,
    kind: extra.kind || "practice",
    start: `${date}T${time.start}:00+03:00`,
    end: `${date}T${time.end}:00+03:00`,
    location: extra.location ?? location(descriptor.footer),
    assessment: descriptor.footer.assessment || null,
    sourceType: extra.sourceType || "main_grid",
    source,
    sourceExplicit: true,
    ...extra,
  };
}

function datePart(value) {
  const match = String(value || "").match(/(\d{1,2})\.(\d{1,2})/);
  return match ? { day: Number(match[1]), month: Number(match[2]) } : null;
}

function weekdayDates(year, startText, endText, weekday, whitelist) {
  const start = datePart(startText), end = datePart(endText);
  if (!start || !end) return [];
  const cursor = new Date(Date.UTC(year, start.month - 1, start.day));
  const last = new Date(Date.UTC(year, end.month - 1, end.day));
  const result = [];
  while (cursor <= last) {
    const value = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    if ((cursor.getUTCDay() || 7) === weekday && whitelist.has(value)) result.push(value);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function addPhysicalEducation(events, footer, groups, year, whitelist) {
  const row = footer.find((item) => /^elective discipline in physical culture and sports$/i.test(item.discipline));
  if (!row) return { count: 0, issue: "footer-physical-education-not-found" };
  const text = [row.shift1, row.shift2].find((value) => value && parseTime(value));
  if (!text) return { count: 0, issue: "physical-education-time-not-found" };
  const weekdayToken = clean(text).toLowerCase().match(/(?:^|\s)(понедельник|вторник|среда|четверг|пятница|суббота|monday|tuesday|wednesday|thursday|friday|saturday|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?=\s|$)/)?.[1];
  const range = String(text).match(/(\d{1,2}\.\d{1,2})\s*[-–]\s*(\d{1,2}\.\d{1,2})/);
  const time = parseTime(text);
  const weekday = weekdayToken ? WEEKDAYS.get(weekdayToken) : null;
  if (!weekday || !range || !time) return { count: 0, issue: "physical-education-schedule-ambiguous" };
  const dates = weekdayDates(year, range[1], range[2], weekday, whitelist);
  const descriptor = { title: "Элективные дисциплины по физической культуре и спорту", footer: row };
  for (const group of groups) {
    for (const date of dates) events.push(event(group, date, time, descriptor, {
      kind: "physical_education",
      sourceType: "footer_schedule",
      source: `footer-row-${row.row}`,
    }));
  }
  return { count: dates.length * groups.length, dates, issue: null };
}

function duplicateReport(events) {
  const seen = new Set();
  const duplicates = [];
  for (const item of events) {
    const key = [item.group, item.start, item.end, item.title, item.location].join("|");
    if (seen.has(key)) duplicates.push(item.id);
    seen.add(key);
  }
  return duplicates;
}

function overlapReport(events) {
  const allowed = [], blocking = [];
  const byKey = new Map();
  for (const item of events) {
    const key = `${item.group}|${item.start.slice(0, 10)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  for (const [key, items] of byKey) {
    const [group, date] = key.split("|");
    const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (Date.parse(sorted[j].start) >= Date.parse(sorted[i].end)) break;
        const conflict = { group, date, event1: sorted[i].id, event2: sorted[j].id, title1: sorted[i].title, title2: sorted[j].title, source1: sorted[i].source, source2: sorted[j].source };
        if (sorted[i].sourceExplicit && sorted[j].sourceExplicit) allowed.push(conflict); else blocking.push(conflict);
      }
    }
  }
  return { allowed, blocking };
}

export function isForeignCycleWorkbook(workbook) {
  const text = workbookText(workbook);
  const groups = (workbook?.sheets || []).flatMap((sheet) => sheet.cells || []).map((cell) => groupCode(cell.value)).filter(Boolean);
  return new Set(groups).size >= 4 && (/academic discipline/i.test(text) || /english medium/i.test(text) || /faculty of foreign students/i.test(text));
}

export function parseKgmuForeignCycleWorkbook(workbook, metadata = {}) {
  const { sheet, rows, dateRow } = findCycleSheet(workbook);
  const period = resolvePeriod(workbook, metadata);
  const dates = dateColumns(sheet, rows, dateRow, period.eventYear);
  const whitelist = new Set(dates.values());
  const firstDateCol = Math.min(...dates.keys()), lastDateCol = Math.max(...dates.keys());
  const columns = footerColumns(rows);
  const footer = footerRows(sheet, rows, columns);
  const cells = cellMap(sheet);
  const groupRows = [...rows.entries()].map(([row]) => ({ row, group: groupCode(effectiveValue(sheet, cells, 2, row)) })).filter((item) => item.group);
  const groups = groupRows.map((item) => item.group);
  const styled = sheet.styledCells || [];
  const styledByCoord = new Map(styled.map((cell) => [`${cell.row}|${cell.col}`, cell]));
  const fillToDescriptor = new Map();
  const ignoredFills = new Set();
  const unhandledBlocks = [];

  for (const { row, group } of groupRows) {
    for (const cell of rows.get(row) || []) {
      if (cell.col < firstDateCol || cell.col > lastDateCol) continue;
      const text = clean(cell.value);
      if (!text) continue;
      const styledCell = styledByCoord.get(`${row}|${cell.col}`);
      const fillId = styledCell?.fillId;
      if (/^exams?$/i.test(text) || text === "**") {
        if (fillId) ignoredFills.add(fillId);
        continue;
      }
      if (/^m$/i.test(text)) {
        unhandledBlocks.push({ group, cell: cell.ref, text, reason: "explicit-M-not-supported-in-control-file" });
        continue;
      }
      const descriptor = subjectDescriptor(text.replaceAll("*", ""), footer);
      if (!descriptor) {
        unhandledBlocks.push({ group, cell: cell.ref, text, reason: "unknown-main-grid-subject" });
        continue;
      }
      if (!fillId) {
        unhandledBlocks.push({ group, cell: cell.ref, text, reason: "subject-fill-not-preserved" });
        continue;
      }
      const previous = fillToDescriptor.get(fillId);
      if (previous && previous.title !== descriptor.title) {
        unhandledBlocks.push({ group, cell: cell.ref, text, reason: "fill-maps-to-multiple-subjects", fillId, subjects: [previous.title, descriptor.title] });
        continue;
      }
      fillToDescriptor.set(fillId, descriptor);
    }
  }

  const events = [];
  const practiceCounts = Object.fromEntries(groups.map((group) => [group, 0]));
  const subjectDayCounts = {};
  const missingTimes = [];
  for (const { row, group } of groupRows) {
    for (const [col, date] of dates) {
      const styledCell = styledByCoord.get(`${row}|${col}`);
      if (!styledCell?.fillId || ignoredFills.has(styledCell.fillId)) continue;
      const descriptor = fillToDescriptor.get(styledCell.fillId);
      if (!descriptor) continue;
      const raw = clean(effectiveValue(sheet, cells, col, row));
      const time = timeForPractice(descriptor, raw);
      if (!time) {
        missingTimes.push({ group, date, cell: ref(col, row), subject: descriptor.title });
        continue;
      }
      events.push(event(group, date, time, descriptor, { source: ref(col, row) }));
      practiceCounts[group] += 1;
      subjectDayCounts[descriptor.title] = (subjectDayCounts[descriptor.title] || 0) + 1;
    }
  }
  const mainGridSubjectDays = Object.values(practiceCounts).reduce((a, b) => a + b, 0);
  const pe = addPhysicalEducation(events, footer, groups, period.eventYear, whitelist);
  if (pe.issue) unhandledBlocks.push({ reason: pe.issue });

  const duplicates = duplicateReport(events);
  const overlaps = overlapReport(events);
  const groupCounts = Object.fromEntries(groups.map((group) => [group, events.filter((item) => item.group === group).length]));
  const qa = {
    status: unhandledBlocks.length || missingTimes.length || duplicates.length || overlaps.blocking.length || !mainGridSubjectDays ? "REVIEW_REQUIRED" : "PASS",
    passed: !(unhandledBlocks.length || missingTimes.length || duplicates.length || overlaps.blocking.length || !mainGridSubjectDays),
    sourceBlocks: mainGridSubjectDays,
    coveredSourceBlocks: mainGridSubjectDays,
    mainGridSubjectDays,
    mainGridSubjectDaysByGroup: practiceCounts,
    subjectDayCounts,
    physicalEducationEvents: pe.count,
    unhandledBlocks,
    missingTimes,
    duplicateCount: duplicates.length,
    duplicates,
    allowedOverlaps: overlaps.allowed,
    remainingOverlaps: overlaps.blocking,
    overlapCount: overlaps.allowed.length + overlaps.blocking.length,
    eventCount: events.length,
    groupCounts,
  };

  const program = metadata.program || "foreign";
  const course = Number(metadata.course) || 4;
  const schedules = groupRows.map(({ group }) => ({
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program,
    course,
    academicYear: period.academicYear.label,
    semester: period.semester,
    timezone: "Europe/Moscow",
    parserType: "C",
    parserProfile: "C-FIO",
    parserQa: {
      mainGridSubjectDays: qa.mainGridSubjectDaysByGroup[group],
      duplicateCount: events.filter((item) => item.group === group && duplicates.includes(item.id)).length,
      overlapCount: qa.allowedOverlaps.filter((item) => item.group === group).length + qa.remainingOverlaps.filter((item) => item.group === group).length,
    },
    group: {
      id: `kgmu:${program}:${course}:${group}`,
      code: group,
      displayName: `Группа ${group}`,
    },
    sources: metadata.sourceUrl ? [{ url: metadata.sourceUrl, sha256: metadata.sourceSha256 || null }] : [],
    events: events.filter((item) => item.group === group).map(({ group: _group, ...item }) => item),
  }));

  return { type: "C", profile: "C-FIO", schedules, qa };
}
