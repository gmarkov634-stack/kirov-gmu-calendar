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

const SUBJECTS = [
  {
    title: "Поликлиническая терапия",
    grid: [/^поликлиническая терапия$/i, /^polyclinic therapy$/i],
    footer: [/^поликлиническая терапия$/i, /^polyclinic therapy$/i],
  },
  {
    title: "Госпитальная терапия (модуль)",
    grid: [/^госпитальная терапия(?:\s*\(модуль\))?$/i, /^hospital therapy(?:\s*\(module\))?$/i],
    footer: [/^госпитальная терапия(?:\s*\(модуль\))?$/i, /^hospital therapy(?:\s*\(module\))?$/i],
  },
  {
    title: "Фтизиатрия",
    grid: [/^фтизиатрия$/i, /^phthisiology$/i],
    footer: [/^фтизиатрия$/i, /^phthisiology$/i],
  },
  {
    title: "Гематология",
    grid: [/^гематология$/i, /^hematology$/i],
    footer: [/^гематология$/i, /^hematology$/i],
  },
  {
    title: "Клиническая иммунология и аллергология",
    grid: [/^клин\.?\s*иммунол?огия и аллергология$/i, /^клиническая иммунология и аллергология$/i, /^clinical immunology and allergology$/i],
    footer: [/^клиническая иммунология и аллергология$/i, /^clinical immunology and allergology$/i],
  },
  {
    title: "Обучающий симуляционный курс (ОСК)",
    grid: [/^оск$/i, /^esc$/i, /^обучающий симуляционный курс(?:\s*\(оск\))?$/i, /^educational simulation course(?:\s*\(esc\))?$/i],
    footer: [/^обучающий симуляционный курс(?:\s*\(оск\))?$/i, /^educational simulation course(?:\s*\(esc\))?$/i],
  },
];

const ONCOLOGY_GRID = [/^онкология,?\s*лучевая терапия\*?$/i, /^oncology,?\s*radiology therapy\*?$/i];
const ONCOLOGY_FOOTER = [/^онкология,?\s*лучевая терапия$/i, /^oncology,?\s*radiology therapy$/i];
const ELECTIVE_GRID = /^(?:электив|elective discipline|дв\.?\s*\d+)$/i;
const SERVICE_GRID = /^(?:ср|самостоятельная работа|individual work|гиа|final state examination|экзамен|exam|экзамены|exams|groups|группы)$/i;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*-?\s*([иi])$/i);
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
    throw Object.assign(new Error("Cannot resolve course 6 C-FIO academic period"), { code: "KGMU_CFIO6_PERIOD_UNKNOWN" });
  }
  return { academicYear, semester, eventYear: semester === 1 ? academicYear.start : academicYear.end };
}

function rowsOf(sheet) {
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  for (const cells of rows.values()) cells.sort((a, b) => a.col - b.col);
  return rows;
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
    const groups = [...rows.values()].flat().map((cell) => groupCode(cell.value)).filter((code) => /^60[1-6]и$/.test(code || ""));
    if (dateRow && new Set(groups).size >= 5) return { sheet, rows, dateRow };
  }
  throw Object.assign(new Error("Course 6 C-FIO calendar grid was not found"), { code: "KGMU_CFIO6_GRID_NOT_FOUND" });
}

function dateColumns(rows, dateRow, year) {
  const monthRows = [...rows.entries()].filter(([row]) => row < dateRow && row >= dateRow - 3).sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) throw Object.assign(new Error("Course 6 C-FIO month header was not found"), { code: "KGMU_CFIO6_MONTH_HEADER_NOT_FOUND" });
  const starts = (rows.get(monthRow) || []).map((cell) => ({ col: cell.col, month: monthNumber(cell.value) })).filter((item) => item.month).sort((a, b) => a.col - b.col);
  const dates = new Map();
  for (const cell of rows.get(dateRow) || []) {
    const day = Number(cell.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const month = [...starts].reverse().find((item) => item.col <= cell.col)?.month;
    if (month) dates.set(cell.col, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
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
  throw Object.assign(new Error("Course 6 C-FIO footer was not found"), { code: "KGMU_CFIO6_FOOTER_NOT_FOUND" });
}

function footerRows(sheet, rows, columns) {
  const cells = cellsOf(sheet);
  const maxRow = Math.max(...rows.keys());
  const result = [];
  for (let row = columns.headerRow + 2; row <= maxRow; row += 1) {
    const discipline = clean(effectiveValue(sheet, cells, columns.discipline, row));
    if (!discipline || /^\d{4,6}$/.test(discipline)) continue;
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

function parseTimes(value) {
  const result = [];
  for (const match of String(value || "").matchAll(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/g)) {
    const sh = Number(match[1]), sm = Number(match[2]), eh = Number(match[3]), em = Number(match[4]);
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) continue;
    const duration = eh * 60 + em - (sh * 60 + sm);
    if (duration <= 0 || duration > 420) continue;
    result.push({ start: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`, end: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}` });
  }
  return result;
}

function oneTime(row) {
  const times = [...parseTimes(row.shift1), ...parseTimes(row.shift2)];
  return times.length === 1 ? times[0] : null;
}

function descriptorFor(text, footer) {
  const value = clean(text).replace(/\*+$/g, "").trim();
  const definition = SUBJECTS.find((subject) => subject.grid.some((pattern) => pattern.test(value)));
  if (!definition) return null;
  const row = footer.find((item) => definition.footer.some((pattern) => pattern.test(item.discipline)));
  return row ? { ...definition, footer: row } : null;
}

function oncologyFooter(footer) {
  return footer.find((item) => ONCOLOGY_FOOTER.some((pattern) => pattern.test(item.discipline))) || null;
}

function stableId(group, date, start, title, source) {
  const digest = createHash("sha1").update([group, date, start, title, source].join("|")).digest("hex").slice(0, 12);
  return `kgmu-${group}-${date}-${start.replace(":", "")}-${digest}`;
}

function location(row) {
  return [row.base, row.address].filter(Boolean).join(", ");
}

function makeEvent(group, date, time, descriptor, sourceCell) {
  return {
    id: stableId(group, date, time.start, descriptor.title, sourceCell),
    group,
    title: descriptor.title,
    discipline: descriptor.title,
    kind: "practice",
    start: `${date}T${time.start}:00+03:00`,
    end: `${date}T${time.end}:00+03:00`,
    location: location(descriptor.footer),
    assessment: descriptor.footer.assessment || null,
    sourceType: "main_grid",
    source: sourceCell,
    sourceCell,
    sourceExplicit: true,
  };
}

function contiguousRuns(row, fillId, dates, styledByCoord) {
  const cols = [...dates.keys()].filter((col) => styledByCoord.get(`${row}|${col}`)?.fillId === fillId).sort((a, b) => a - b);
  const runs = [];
  let current = [];
  for (const col of cols) {
    if (!current.length || col === current[current.length - 1] + 1) current.push(col);
    else { runs.push(current); current = [col]; }
  }
  if (current.length) runs.push(current);
  return runs;
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
        const conflict = { group, date, event1: sorted[i].id, event2: sorted[j].id, title1: sorted[i].title, title2: sorted[j].title, source1: sorted[i].source, source2: sorted[j].source };
        if (sorted[i].sourceExplicit && sorted[j].sourceExplicit) allowed.push(conflict);
        else blocking.push(conflict);
      }
    }
  }
  return { allowed, blocking };
}

export function parseKgmuForeignCourse6Workbook(workbook, metadata = {}) {
  const { sheet, rows, dateRow } = findCycleSheet(workbook);
  const period = resolvePeriod(workbook, metadata);
  const language = sourceLanguage(workbook);
  const dates = dateColumns(rows, dateRow, period.eventYear);
  const firstDateCol = Math.min(...dates.keys()), lastDateCol = Math.max(...dates.keys());
  const columns = footerColumns(rows);
  const footer = footerRows(sheet, rows, columns);
  const cells = cellsOf(sheet);
  const allGroupRows = [...rows.entries()]
    .map(([row]) => ({ row, group: groupCode(effectiveValue(sheet, cells, 2, row)) }))
    .filter((item) => /^60[1-6]и$/.test(item.group || ""));
  const expectedGroups = ["601и", "602и", "603и", "604и", "605и"];
  const groupRows = allGroupRows.filter((item) => expectedGroups.includes(item.group));
  const groups = groupRows.map((item) => item.group);
  const missingGroups = expectedGroups.filter((group) => !groups.includes(group));
  if (missingGroups.length) throw Object.assign(new Error("Course 6 C-FIO primary group set is incomplete"), { code: "KGMU_CFIO6_GROUPS_INVALID", groups, missingGroups });

  const styledByCoord = new Map((sheet.styledCells || []).map((cell) => [`${cell.row}|${cell.col}`, cell]));
  const fillToDescriptor = new Map();
  const oncologyFills = new Set();
  const electiveFills = new Set();
  const serviceCoords = new Set();
  const unhandledBlocks = [];
  const examInterruptions = [];

  for (const { row, group } of groupRows) {
    for (const cell of rows.get(row) || []) {
      if (cell.col < firstDateCol || cell.col > lastDateCol) continue;
      const text = clean(cell.value);
      if (!text) continue;
      const fillId = styledByCoord.get(`${row}|${cell.col}`)?.fillId;
      const coord = `${row}|${cell.col}`;
      if (SERVICE_GRID.test(text)) {
        serviceCoords.add(coord);
        if (/^(?:экзамен|exam)$/i.test(text)) examInterruptions.push({ group, date: dates.get(cell.col) || null, cell: cell.ref, text, fillId: fillId || null });
        continue;
      }
      if (ELECTIVE_GRID.test(text)) {
        if (fillId) electiveFills.add(fillId);
        else unhandledBlocks.push({ group, cell: cell.ref, text, reason: "elective-fill-not-preserved" });
        continue;
      }
      if (ONCOLOGY_GRID.some((pattern) => pattern.test(text))) {
        if (fillId) oncologyFills.add(fillId);
        else unhandledBlocks.push({ group, cell: cell.ref, text, reason: "oncology-fill-not-preserved" });
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
    }
  }

  const events = [];
  const eventCounts = Object.fromEntries(groups.map((group) => [group, 0]));
  const subjectDayCounts = {};
  const missingTimes = [];

  for (const { row, group } of groupRows) {
    for (const [col, date] of dates) {
      const coord = `${row}|${col}`;
      if (serviceCoords.has(coord)) continue;
      const fillId = styledByCoord.get(coord)?.fillId;
      if (!fillId || oncologyFills.has(fillId) || electiveFills.has(fillId)) continue;
      const descriptor = fillToDescriptor.get(fillId);
      if (!descriptor) continue;
      const time = oneTime(descriptor.footer);
      if (!time) {
        missingTimes.push({ group, date, cell: ref(col, row), subject: descriptor.title, footerRow: descriptor.footer.row });
        continue;
      }
      events.push(makeEvent(group, date, time, descriptor, ref(col, row)));
      eventCounts[group] += 1;
      subjectDayCounts[descriptor.title] = (subjectDayCounts[descriptor.title] || 0) + 1;
    }
  }

  const oncologyRow = oncologyFooter(footer);
  const oncologyTimes = oncologyRow ? [...parseTimes(oncologyRow.shift1), ...parseTimes(oncologyRow.shift2)] : [];
  const ambiguousOncologyLongDays = [];
  for (const { row, group } of groupRows) {
    for (const fillId of oncologyFills) {
      for (const run of contiguousRuns(row, fillId, dates, styledByCoord)) {
        if (!run.length) continue;
        ambiguousOncologyLongDays.push({
          group,
          fillId,
          startDate: dates.get(run[0]),
          endDate: dates.get(run[run.length - 1]),
          dates: run.map((col) => dates.get(col)),
          dayCount: run.length,
          sourceCell: ref(run[0], row),
          normalTime: oncologyTimes[0] || null,
          exceptionalTime: oncologyTimes[1] || null,
          exceptionalDayCount: 3,
          reason: "source-does-not-identify-which-three-oncology-days-use-long-time",
        });
      }
    }
  }

  const ambiguousElectiveAssignments = [];
  for (const { row, group } of groupRows) {
    for (const fillId of electiveFills) {
      for (const run of contiguousRuns(row, fillId, dates, styledByCoord)) {
        if (!run.length) continue;
        const markers = (rows.get(row) || [])
          .filter((cell) => run.includes(cell.col) && ELECTIVE_GRID.test(clean(cell.value)))
          .map((cell) => ({ cell: cell.ref, text: clean(cell.value), date: dates.get(cell.col) || null }));
        ambiguousElectiveAssignments.push({
          group,
          fillId,
          startDate: dates.get(run[0]),
          endDate: dates.get(run[run.length - 1]),
          dates: run.map((col) => dates.get(col)),
          markers,
          reason: "source-does-not-map-group-or-student-to-an-elective-option",
        });
      }
    }
  }

  const mirrorSemanticRisks = [];
  const sourceGroups = allGroupRows.map((item) => item.group);
  const extraGroups = sourceGroups.filter((group) => !expectedGroups.includes(group));
  if (extraGroups.length) mirrorSemanticRisks.push({ reason: "mirror-extra-groups-not-present-in-russian-primary", extraGroups, sourceLanguage: language });

  const duplicates = duplicateReport(events);
  const overlaps = overlapReport(events);
  const groupCounts = Object.fromEntries(groups.map((group) => [group, events.filter((event) => event.group === group).length]));
  const deterministicMainGridEvents = Object.values(eventCounts).reduce((sum, count) => sum + count, 0);
  const blocked = unhandledBlocks.length || missingTimes.length || ambiguousOncologyLongDays.length || ambiguousElectiveAssignments.length || mirrorSemanticRisks.length || duplicates.length || overlaps.blocking.length;
  const qa = {
    status: blocked ? "REVIEW_REQUIRED" : "PASS",
    passed: !blocked,
    sourceLanguage: language,
    sourceGroups,
    primaryGroups: groups,
    deterministicMainGridEvents,
    deterministicMainGridEventsByGroup: eventCounts,
    subjectDayCounts,
    examInterruptions,
    ambiguousOncologyLongDays,
    ambiguousElectiveAssignments,
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
  const course = 6;
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
      deterministicMainGridEvents: qa.deterministicMainGridEventsByGroup[group],
      oncologyAmbiguities: qa.ambiguousOncologyLongDays.filter((item) => item.group === group).length,
      electiveAmbiguities: qa.ambiguousElectiveAssignments.filter((item) => item.group === group).length,
      examInterruptions: qa.examInterruptions.filter((item) => item.group === group).length,
    },
    group: { id: `kgmu:${program}:${course}:${group}`, code: group, displayName: `Группа ${group}` },
    sources: metadata.sourceUrl ? [{ url: metadata.sourceUrl, sha256: metadata.sourceSha256 || null }] : [],
    events: events.filter((event) => event.group === group).map(({ group: _group, ...event }) => event),
  }));

  return { type: "C", profile: "C-FIO", course: 6, schedules, qa };
}
