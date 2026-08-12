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
  {
    title: "Русский язык как язык специальности",
    grid: [/^russian as the language of specialty$/i, /^русский язык как язык спец(?:иальности|-ти)$/i],
    footer: [/^russian as the language of specialty$/i, /^русский язык как язык специальности$/i],
  },
  {
    title: "Практика по неотложным медицинским манипуляциям",
    grid: [/^(?:umm|practical training in urgent medical manipulations(?:\s*\(umm\))?)$/i, /^практика по (?:нмм|неотложным медицинским манипуляциям)$/i],
    footer: [/^practical training in urgent medical manipulations(?:\s*\(umm\))?$/i, /^практика по неотложным медицинским манипуляциям$/i],
  },
  {
    title: "Госпитальная терапия (модуль)",
    grid: [/^hospital therapy(?:\s*\(module\))?$/i, /^госпитальная терапия(?:\s*\(модуль\))?$/i],
    footer: [/^hospital therapy\s*\(module\)$/i, /^госпитальная терапия\s*\(модуль\)$/i],
  },
  {
    title: "Педиатрия",
    grid: [/^pediatrics$/i, /^педиатрия$/i],
    footer: [/^pediatrics$/i, /^педиатрия$/i],
  },
  {
    title: "Детские инфекционные болезни (раздел)",
    grid: [/^(?:cid|children'?s infectious diseases(?:\s*\((?:module|cid)\))?(?:\s*\(cid\))?)$/i, /^диб$/i, /^детские инфекционные болезни(?:\s*\((?:раздел|модуль)\))?$/i],
    footer: [/^children'?s infectious diseases(?:\s*\(module\))?(?:\s*\(cid\))?$/i, /^детские инфекционные болезни(?:\s*\((?:раздел|модуль)\))?$/i],
  },
  {
    title: "Инфекционные болезни",
    grid: [/^infectious diseases$/i, /^инфекционные болезни$/i],
    footer: [/^infectious diseases$/i, /^инфекционные болезни$/i],
  },
  {
    title: "Травматология и ортопедия",
    grid: [/^traumatology and orthopedics$/i, /^травматология и ортопедия$/i],
    footer: [/^traumatology and orthopedics$/i, /^травматология и ортопедия$/i],
  },
  {
    title: "Акушерство и гинекология",
    grid: [/^obstetrics and gynecology$/i, /^акушерство и гинекология$/i],
    footer: [/^obstetrics and gynecology$/i, /^акушерство и гинекология$/i],
  },
  {
    title: "Госпитальная хирургия (модуль)",
    grid: [/^hospital surgery(?:\s*\(module\))?$/i, /^госпитальная хирургия(?:\s*\(модуль\))?$/i],
    footer: [/^hospital surgery\s*\(module\)$/i, /^госпитальная хирургия\s*\(модуль\)$/i],
  },
  {
    title: "Детская хирургия (модуль)",
    grid: [/^pediatric surgery(?:\s*\(module\))?$/i, /^детская хирургия(?:\s*\(модуль\))?$/i],
    footer: [/^pediatric surgery\s*\(module\)$/i, /^детская хирургия\s*\(модуль\)$/i],
  },
  {
    title: "Эндокринология",
    grid: [/^endocrinology$/i, /^эндокринология$/i],
    footer: [/^endocrinology$/i, /^эндокринология$/i],
  },
];

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*-?\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}

function groupTokens(value) {
  return [...String(value || "").matchAll(/(\d{3})\s*-?\s*([иi])/gi)].map((match) => `${match[1]}и`);
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

function sourceLanguage(workbook) {
  const text = workbookText(workbook);
  const russian = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return russian > latin ? "ru" : "en";
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
    throw Object.assign(new Error("Cannot resolve course 5 C-FIO academic period"), { code: "KGMU_CFIO5_PERIOD_UNKNOWN" });
  }
  return { academicYear, semester, eventYear: semester === 1 ? academicYear.start : academicYear.end };
}

function rowsOf(sheet) {
  const result = new Map();
  for (const cell of sheet.cells || []) {
    if (!result.has(cell.row)) result.set(cell.row, []);
    result.get(cell.row).push(cell);
  }
  for (const cells of result.values()) cells.sort((a, b) => a.col - b.col);
  return result;
}

function cellsOf(sheet) {
  return new Map((sheet.cells || []).map((cell) => [cell.ref, cell]));
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

function mergeAt(sheet, col, row) {
  return (sheet.merges || []).find((merge) => merge.startCol <= col && col <= merge.endCol && merge.startRow <= row && row <= merge.endRow) || null;
}

function effectiveCell(sheet, cells, col, row) {
  const direct = cells.get(ref(col, row));
  if (direct) return direct;
  const merge = mergeAt(sheet, col, row);
  return merge ? cells.get(merge.startRef) || null : null;
}

function effectiveValue(sheet, cells, col, row) {
  return effectiveCell(sheet, cells, col, row)?.value ?? "";
}

function findCycleSheet(workbook) {
  for (const sheet of workbook?.sheets || []) {
    const rows = rowsOf(sheet);
    const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
      const day = Number(cell.value);
      return Number.isInteger(day) && day >= 1 && day <= 31;
    }).length >= 10)?.[0];
    const groups = [...rows.values()].flat().map((cell) => groupCode(cell.value)).filter((code) => /^50[1-6]и$/.test(code || ""));
    if (dateRow && new Set(groups).size === 6) return { sheet, rows, dateRow };
  }
  throw Object.assign(new Error("Course 5 C-FIO calendar grid was not found"), { code: "KGMU_CFIO5_GRID_NOT_FOUND" });
}

function dateColumns(rows, dateRow, year) {
  const monthRows = [...rows.entries()].filter(([row]) => row < dateRow && row >= dateRow - 3).sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) throw Object.assign(new Error("Course 5 C-FIO month header was not found"), { code: "KGMU_CFIO5_MONTH_HEADER_NOT_FOUND" });
  const starts = (rows.get(monthRow) || []).map((cell) => ({ col: cell.col, month: monthNumber(cell.value) })).filter((item) => item.month).sort((a, b) => a.col - b.col);
  const result = new Map();
  for (const cell of rows.get(dateRow) || []) {
    const day = Number(cell.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const month = [...starts].reverse().find((item) => item.col <= cell.col)?.month;
    if (month) result.set(cell.col, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return result;
}

function footerColumns(rows) {
  for (const [row, cells] of rows) {
    const find = (pattern) => cells.find((cell) => pattern.test(clean(cell.value)))?.col;
    const discipline = find(/^(?:(?:academic\s+)?discipline|дисциплина)$/i);
    if (!discipline) continue;
    const sub = rows.get(row + 1) || [];
    return {
      headerRow: row,
      discipline,
      assessment: find(/^(?:form of assessment|форма промежуточной аттестации)$/i),
      department: find(/^(?:department|кафедра)$/i),
      base: find(/^(?:place of practical training|база практической подготовки)$/i),
      address: find(/^(?:address|адрес)$/i),
      shift1: sub.find((cell) => /^(?:1st\s+part of the day|1\s*смена)$/i.test(clean(cell.value)))?.col,
      shift2: sub.find((cell) => /^(?:2nd\s+part of the day|2\s*смена)$/i.test(clean(cell.value)))?.col,
    };
  }
  throw Object.assign(new Error("Course 5 C-FIO footer was not found"), { code: "KGMU_CFIO5_FOOTER_NOT_FOUND" });
}

function footerRows(sheet, rows, columns) {
  const cells = cellsOf(sheet);
  const maxRow = Math.max(...rows.keys());
  const result = [];
  for (let row = columns.headerRow + 2; row <= maxRow; row += 1) {
    const discipline = clean(effectiveValue(sheet, cells, columns.discipline, row));
    if (!discipline || /lectures? on the disciplines?.*(?:educational|website)/i.test(discipline) || /лекции по дисциплинам.*(?:образовательн|сайт)/i.test(discipline)) continue;
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

function groupSpecificTimes(value) {
  const text = String(value || "");
  const result = new Map();
  const timePattern = /(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/g;
  let previousEnd = 0;
  for (const match of text.matchAll(timePattern)) {
    const segment = text.slice(previousEnd, match.index);
    const time = parseTime(match[0]);
    if (time) for (const group of groupTokens(segment)) result.set(group, time);
    previousEnd = match.index + match[0].length;
  }
  return result;
}

function descriptorFor(text, footer) {
  const value = clean(text).replace(/\*+$/g, "").trim();
  const definition = SUBJECTS.find((subject) => subject.grid.some((pattern) => pattern.test(value)));
  if (!definition) return null;
  const row = footer.find((item) => definition.footer.some((pattern) => pattern.test(item.discipline)));
  return row ? { ...definition, footer: row } : null;
}

function practiceTime(descriptor, group, firstDayFirstShift) {
  const specific = new Map([...groupSpecificTimes(descriptor.footer.shift1), ...groupSpecificTimes(descriptor.footer.shift2)]).get(group);
  if (specific) return specific;
  const first = parseTime(descriptor.footer.shift1);
  const second = parseTime(descriptor.footer.shift2);
  if (first && !second) return first;
  if (!first && second) return second;
  if (first && second) return firstDayFirstShift ? first : second;
  return null;
}

function stableId(group, date, start, title, source) {
  const digest = createHash("sha1").update([group, date, start, title, source].join("|")).digest("hex").slice(0, 12);
  return `kgmu-${group}-${date}-${start.replace(":", "")}-${digest}`;
}

function location(row) {
  return [row.base, row.address].filter(Boolean).join(", ");
}

function makeEvent(group, date, time, descriptor, extra = {}) {
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
    sourceCell: extra.sourceCell || null,
    sourceExplicit: true,
    ...extra,
  };
}

function datePart(value) {
  const match = String(value || "").match(/(\d{1,2})\.(\d{1,2})/);
  return match ? { day: Number(match[1]), month: Number(match[2]) } : null;
}

function weekdayFromText(value) {
  const text = clean(value).toLowerCase();
  for (const [token, weekday] of WEEKDAYS) {
    if (new RegExp(`(?:^|\\s)${token}(?=\\s|$)`, "i").test(text)) return weekday;
  }
  return null;
}

function weekdayDates(year, startText, endText, weekday, whitelist) {
  const start = datePart(startText), end = datePart(endText);
  if (!start || !end) return [];
  const cursor = new Date(Date.UTC(year, start.month - 1, start.day));
  const last = new Date(Date.UTC(year, end.month - 1, end.day));
  const result = [];
  while (cursor <= last) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    if ((cursor.getUTCDay() || 7) === weekday && whitelist.has(date)) result.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function isPhysicalEducation(value) {
  const text = clean(value);
  return /physical culture and sports/i.test(text) || /физическ(?:ой|ая) культуре и спорту/i.test(text);
}

function addPhysicalEducation(events, footer, groups, year, whitelist) {
  const row = footer.find((item) => isPhysicalEducation(item.discipline));
  if (!row) return { count: 0, issue: "footer-physical-education-not-found" };
  const text = [row.shift1, row.shift2].find((value) => value && parseTime(value));
  if (!text) return { count: 0, issue: "physical-education-time-not-found" };
  const datesInText = [...String(text).matchAll(/\d{1,2}\.\d{1,2}/g)].map((match) => match[0]);
  const weekday = weekdayFromText(text);
  const time = parseTime(text);
  if (!weekday || datesInText.length < 2 || !time) return { count: 0, issue: "physical-education-schedule-ambiguous" };
  const dates = weekdayDates(year, datesInText[0], datesInText[1], weekday, whitelist);
  const descriptor = { title: "Дисциплины по физической культуре и спорту", footer: row };
  for (const group of groups) {
    for (const date of dates) {
      events.push(makeEvent(group, date, time, descriptor, {
        kind: "physical_education",
        sourceType: "footer_schedule",
        source: `footer-row-${row.row}`,
      }));
    }
  }
  return { count: dates.length * groups.length, dates, issue: null };
}

function duplicateReport(events) {
  const seen = new Set();
  const duplicates = [];
  for (const event of events) {
    const key = [event.group, event.start, event.end, event.title, event.location].join("|");
    if (seen.has(key)) duplicates.push(event.id);
    seen.add(key);
  }
  return duplicates;
}

function overlapReport(events) {
  const allowed = [], blocking = [];
  const byDay = new Map();
  for (const event of events) {
    const key = `${event.group}|${event.start.slice(0, 10)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  for (const [key, dayEvents] of byDay) {
    const [group, date] = key.split("|");
    const sorted = [...dayEvents].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (Date.parse(sorted[j].start) >= Date.parse(sorted[i].end)) break;
        const conflict = {
          group,
          date,
          event1: sorted[i].id,
          event2: sorted[j].id,
          title1: sorted[i].title,
          title2: sorted[j].title,
          source1: sorted[i].source,
          source2: sorted[j].source,
        };
        if (sorted[i].sourceExplicit && sorted[j].sourceExplicit) allowed.push(conflict);
        else blocking.push(conflict);
      }
    }
  }
  return { allowed, blocking };
}

export function parseKgmuForeignCourse5Workbook(workbook, metadata = {}) {
  const { sheet, rows, dateRow } = findCycleSheet(workbook);
  const period = resolvePeriod(workbook, metadata);
  const language = sourceLanguage(workbook);
  const dates = dateColumns(rows, dateRow, period.eventYear);
  const whitelist = new Set(dates.values());
  const firstDateCol = Math.min(...dates.keys()), lastDateCol = Math.max(...dates.keys());
  const columns = footerColumns(rows);
  const footer = footerRows(sheet, rows, columns);
  const cells = cellsOf(sheet);
  const groupRows = [...rows.entries()]
    .map(([row]) => ({ row, group: groupCode(effectiveValue(sheet, cells, 2, row)) }))
    .filter((item) => /^50[1-6]и$/.test(item.group || ""));
  const groups = groupRows.map((item) => item.group);
  if (groups.length !== 6) throw Object.assign(new Error("Course 5 C-FIO requires groups 501и-506и"), { code: "KGMU_CFIO5_GROUPS_INVALID", groups });

  const styledByCoord = new Map((sheet.styledCells || []).map((cell) => [`${cell.row}|${cell.col}`, cell]));
  const fillToDescriptor = new Map();
  const ignoredFills = new Set();
  const starStartByGroupFill = new Map();
  const unhandledBlocks = [];

  for (const { row, group } of groupRows) {
    for (const cell of rows.get(row) || []) {
      if (cell.col < firstDateCol || cell.col > lastDateCol) continue;
      const text = clean(cell.value);
      if (!text) continue;
      const fillId = styledByCoord.get(`${row}|${cell.col}`)?.fillId;
      if (/^(?:exams?|экзамены?)$/i.test(text) || text === "**") {
        if (fillId) ignoredFills.add(fillId);
        continue;
      }
      if (/^m$/i.test(text)) {
        unhandledBlocks.push({ group, cell: cell.ref, text, reason: "explicit-M-not-supported" });
        continue;
      }
      const descriptor = descriptorFor(text, footer);
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
      if (text.includes("*")) starStartByGroupFill.set(`${group}|${fillId}`, cell.col);
    }
  }

  const events = [];
  const practiceCounts = Object.fromEntries(groups.map((group) => [group, 0]));
  const subjectDayCounts = {};
  const missingTimes = [];
  const starApplications = [];

  for (const { row, group } of groupRows) {
    for (const [col, date] of dates) {
      const styledCell = styledByCoord.get(`${row}|${col}`);
      if (!styledCell?.fillId || ignoredFills.has(styledCell.fillId)) continue;
      const descriptor = fillToDescriptor.get(styledCell.fillId);
      if (!descriptor) continue;
      const starCol = starStartByGroupFill.get(`${group}|${styledCell.fillId}`);
      const firstDayFirstShift = Number.isInteger(starCol) && starCol === col;
      const time = practiceTime(descriptor, group, firstDayFirstShift);
      if (!time) {
        missingTimes.push({ group, date, cell: ref(col, row), subject: descriptor.title });
        continue;
      }
      if (firstDayFirstShift) starApplications.push({ group, date, cell: ref(col, row), subject: descriptor.title, time });
      events.push(makeEvent(group, date, time, descriptor, { source: ref(col, row), sourceCell: ref(col, row) }));
      practiceCounts[group] += 1;
      subjectDayCounts[descriptor.title] = (subjectDayCounts[descriptor.title] || 0) + 1;
    }
  }

  const mainGridSubjectDays = Object.values(practiceCounts).reduce((sum, count) => sum + count, 0);
  const pe = addPhysicalEducation(events, footer, groups, period.eventYear, whitelist);
  if (pe.issue) unhandledBlocks.push({ reason: pe.issue });

  const mirrorSemanticRisks = [];
  if (language === "en") {
    const ambiguous = footer.filter((row) => parseTime(row.shift1) && parseTime(row.shift2) && !groupSpecificTimes(row.shift1).size && !groupSpecificTimes(row.shift2).size);
    if (ambiguous.length) {
      mirrorSemanticRisks.push({
        reason: "english-mirror-two-shift-star-semantics-not-authoritative",
        subjects: ambiguous.map((row) => row.discipline),
      });
    }
  }

  const duplicates = duplicateReport(events);
  const overlaps = overlapReport(events);
  const groupCounts = Object.fromEntries(groups.map((group) => [group, events.filter((event) => event.group === group).length]));
  const blocked = unhandledBlocks.length || missingTimes.length || mirrorSemanticRisks.length || duplicates.length || overlaps.blocking.length || !mainGridSubjectDays;
  const qa = {
    status: blocked ? "REVIEW_REQUIRED" : "PASS",
    passed: !blocked,
    sourceLanguage: language,
    mainGridSubjectDays,
    mainGridSubjectDaysByGroup: practiceCounts,
    subjectDayCounts,
    physicalEducationEvents: pe.count,
    physicalEducationDates: pe.dates || [],
    starApplications,
    mirrorSemanticRisks,
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
  const course = 5;
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
      duplicateCount: events.filter((event) => event.group === group && duplicates.includes(event.id)).length,
      overlapCount: qa.allowedOverlaps.filter((item) => item.group === group).length + qa.remainingOverlaps.filter((item) => item.group === group).length,
    },
    group: { id: `kgmu:${program}:${course}:${group}`, code: group, displayName: `Группа ${group}` },
    sources: metadata.sourceUrl ? [{ url: metadata.sourceUrl, sha256: metadata.sourceSha256 || null }] : [],
    events: events.filter((event) => event.group === group).map(({ group: _group, ...event }) => event),
  }));

  return { type: "C", profile: "C-FIO", course: 5, schedules, qa };
}
