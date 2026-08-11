import { createHash } from "node:crypto";

const MONTHS = new Map([
  ["январ", 1], ["феврал", 2], ["март", 3], ["апрел", 4], ["май", 5], ["мая", 5], ["июн", 6],
  ["июл", 7], ["август", 8], ["сентябр", 9], ["октябр", 10], ["ноябр", 11], ["декабр", 12],
]);
const WEEKDAYS = new Map([
  ["пн", 1], ["понедельник", 1], ["вт", 2], ["вторник", 2], ["ср", 3], ["среда", 3],
  ["чт", 4], ["четверг", 4], ["пт", 5], ["пятница", 5], ["сб", 6], ["суббота", 6],
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function colLetters(col) {
  let value = Number(col);
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function ref(col, row) {
  return `${colLetters(col)}${row}`;
}

function cellMap(sheet) {
  return new Map((sheet?.cells || []).map((cell) => [cell.ref, cell]));
}

function mergeAt(sheet, col, row) {
  return (sheet?.merges || []).find((merge) =>
    merge.startCol <= col && col <= merge.endCol && merge.startRow <= row && row <= merge.endRow,
  ) || null;
}

function effectiveValue(sheet, cells, col, row) {
  const direct = cells.get(ref(col, row));
  if (direct) return direct.value;
  const merge = mergeAt(sheet, col, row);
  if (!merge) return "";
  return cells.get(merge.startRef)?.value ?? "";
}

function monthNumber(value) {
  const text = clean(value).toLowerCase();
  for (const [stem, month] of MONTHS) if (text.includes(stem)) return month;
  return null;
}

function normalizedAcademicYear(value) {
  const match = String(value || "").match(/(\d{4})\D+(\d{2,4})/);
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
  let academicYear = normalizedAcademicYear(metadata.academicYear);
  if (!academicYear) academicYear = normalizedAcademicYear(workbookText(workbook));
  const semester = [1, 2].includes(Number(metadata.semester))
    ? Number(metadata.semester)
    : /втор(?:ое|ой)\s+полугод/i.test(workbookText(workbook)) ? 2 : /перв(?:ое|ый)\s+полугод/i.test(workbookText(workbook)) ? 1 : null;
  if (!academicYear || !semester) {
    const error = new Error("Cannot resolve academic year/semester from KGMU workbook");
    error.code = "KGMU_PERIOD_UNKNOWN";
    throw error;
  }
  return { academicYear, semester, eventYear: semester === 1 ? academicYear.start : academicYear.end };
}

function findCycleSheet(workbook) {
  for (const sheet of workbook?.sheets || []) {
    const rows = new Map();
    for (const cell of sheet.cells || []) {
      if (!rows.has(cell.row)) rows.set(cell.row, []);
      rows.get(cell.row).push(cell);
    }
    const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
      const n = Number(cell.value);
      return Number.isInteger(n) && n >= 1 && n <= 31;
    }).length >= 10)?.[0];
    if (dateRow) return { sheet, rows, dateRow };
  }
  const error = new Error("Cyclic calendar grid was not found");
  error.code = "KGMU_C_GRID_NOT_FOUND";
  throw error;
}

function dateColumns(sheet, rows, dateRow, year) {
  const monthRows = [...rows.entries()]
    .filter(([row]) => row < dateRow && row >= dateRow - 3)
    .sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) throw Object.assign(new Error("Cyclic month header was not found"), { code: "KGMU_C_MONTH_HEADER_NOT_FOUND" });
  const monthStarts = (rows.get(monthRow) || [])
    .map((cell) => ({ col: cell.col, month: monthNumber(cell.value) }))
    .filter((item) => item.month)
    .sort((a, b) => a.col - b.col);
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

function parseTime(value) {
  const match = String(value || "").match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  return {
    start: `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`,
    end: `${String(Number(match[3])).padStart(2, "0")}:${match[4]}`,
  };
}

function footerColumns(sheet, rows) {
  for (const [row, cells] of rows) {
    const byText = (needle) => cells.find((cell) => clean(cell.value).toLowerCase() === needle)?.col;
    const discipline = byText("дисциплина");
    if (!discipline) continue;
    return {
      headerRow: row,
      discipline,
      assessment: cells.find((cell) => /форма промежуточной аттестации/i.test(clean(cell.value)))?.col,
      base: cells.find((cell) => /база практической подготовки/i.test(clean(cell.value)))?.col,
      address: cells.find((cell) => clean(cell.value).toLowerCase() === "адрес")?.col,
      shift1: [...(rows.get(row + 1) || [])].find((cell) => /1\s*смена/i.test(clean(cell.value)))?.col,
      shift2: [...(rows.get(row + 1) || [])].find((cell) => /2\s*смена/i.test(clean(cell.value)))?.col,
    };
  }
  throw Object.assign(new Error("Cyclic footer reference table was not found"), { code: "KGMU_C_FOOTER_NOT_FOUND" });
}

function normalizeBase(value) {
  const text = clean(value);
  const quote = text.match(/^(.*?)"\s*(.*?)\s*"$/);
  return quote ? `${quote[1].trimEnd()} «${quote[2].trim()}»` : text;
}

function locationFromRow(sheet, cells, columns, row) {
  const base = normalizeBase(effectiveValue(sheet, cells, columns.base, row));
  const address = clean(effectiveValue(sheet, cells, columns.address, row));
  return [base, address].filter(Boolean).join(", ");
}

function footerRows(sheet, rows, columns) {
  const cells = cellMap(sheet);
  const result = [];
  for (let row = columns.headerRow + 1; row <= Math.max(...rows.keys()); row += 1) {
    const discipline = clean(effectiveValue(sheet, cells, columns.discipline, row));
    if (!discipline) continue;
    result.push({
      row,
      discipline,
      assessment: clean(effectiveValue(sheet, cells, columns.assessment, row)) || null,
      base: clean(effectiveValue(sheet, cells, columns.base, row)),
      address: clean(effectiveValue(sheet, cells, columns.address, row)),
      location: locationFromRow(sheet, cells, columns, row),
      shift1: effectiveValue(sheet, cells, columns.shift1, row),
      shift2: columns.shift2 ? effectiveValue(sheet, cells, columns.shift2, row) : "",
    });
  }
  return result;
}

function findFooter(footer, predicate) {
  return footer.find((row) => predicate(row.discipline.toLowerCase())) || null;
}

function mainSpec(text, footer) {
  const raw = clean(text);
  const starred = raw.includes("*");
  const value = raw.replaceAll("*", "").trim();
  if (value === "М") {
    const row = findFooter(footer, (name) => name.startsWith("менеджмент в здравоохранении"));
    return row && { key: "management", title: "ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ", discipline: "Менеджмент в здравоохранении", kind: "project_defense", starred: false, footer: row };
  }
  const specs = [
    [/^факультетская терапия|^факультетская терапия/i, (name) => name.startsWith("факультетская терапия") && /практ/i.test(name), "Факультетская терапия, профессиональные болезни"],
    [/^менеджмент/i, (name) => name.startsWith("менеджмент в здравоохранении"), "Менеджмент в здравоохранении"],
    [/^педиатрия$/i, (name) => name === "педиатрия", "Педиатрия"],
    [/^урология/i, (name) => name.startsWith("урология"), "Урология (раздел)"],
    [/^факультет\./i, (name) => name.startsWith("факультетская хирургия"), "Факультетская хирургия (раздел)"],
    [/^офтальмология$/i, (name) => name === "офтальмология", "Офтальмология"],
    [/^оториноларингология$/i, (name) => name === "оториноларингология", "Оториноларингология"],
    [/^акушерство и гинекология$/i, (name) => name === "акушерство и гинекология", "Акушерство и гинекология"],
    [/^неврология/i, (name) => name.startsWith("неврология, нейрохирургия"), "Неврология, нейрохирургия"],
    [/^психиатрия/i, (name) => name.startsWith("психиатрия, медицинская психология"), "Психиатрия, медицинская психология"],
  ];
  for (const [pattern, footerMatch, title] of specs) {
    if (!pattern.test(value)) continue;
    const row = findFooter(footer, footerMatch);
    return row && { key: title, title, discipline: title, kind: "practice", starred, footer: row };
  }
  return null;
}

function timeFor(spec, shift) {
  const raw = shift === 2 ? spec.footer.shift2 : spec.footer.shift1;
  return parseTime(raw);
}

function stableId(group, date, start, title, origin) {
  const hash = createHash("sha1").update(`${group}|${date}|${start}|${title}|${origin}`).digest("hex").slice(0, 12);
  return `kgmu-${group}-${date}-${start.replace(":", "")}-${hash}`;
}

function event(group, date, time, spec, extra = {}) {
  const assessment = spec.footer?.assessment || null;
  return {
    id: stableId(group, date, time.start, spec.title, extra.origin || "main_grid"),
    title: spec.title,
    discipline: spec.discipline,
    kind: spec.kind,
    start: `${date}T${time.start}:00+03:00`,
    end: `${date}T${time.end}:00+03:00`,
    location: extra.location ?? spec.footer?.location ?? "",
    assessment,
    sourceType: extra.origin || "main_grid",
    source: extra.source || null,
    ...extra,
  };
}

function datePart(value) {
  const match = String(value || "").match(/(\d{2})\.(\d{2})/);
  return match ? { day: Number(match[1]), month: Number(match[2]) } : null;
}

function iso(year, part) {
  return `${year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

function weekdayDates(year, startText, endText, weekday, whitelist) {
  const start = datePart(startText);
  const end = datePart(endText);
  if (!start || !end) return [];
  const cursor = new Date(Date.UTC(year, start.month - 1, start.day));
  const last = new Date(Date.UTC(year, end.month - 1, end.day));
  const result = [];
  while (cursor <= last) {
    const value = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const day = cursor.getUTCDay() || 7;
    if (day === weekday && whitelist.has(value)) result.push(value);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function addTherapyLectures(events, footer, year, whitelist) {
  const row = findFooter(footer, (name) => name.startsWith("факультетская терапия") && /лекц/i.test(name));
  if (!row) return;
  for (const [stream, groups, text] of [[1, [401, 410], row.shift1], [2, [411, 420], row.shift2]]) {
    const weekdayText = clean(text).toLowerCase().match(/(?:^|\s)(пн|вт|ср|чт|пт|сб|понедельник|вторник|среда|четверг|пятница|суббота)(?:\s|$)/)?.[1];
    const range = String(text).match(/(\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2})/);
    const time = parseTime(text);
    const room = String(text).match(/ауд\.\s*(?:\d+-)?(\d+)/i)?.[1];
    if (!weekdayText || !range || !time || !room) continue;
    const dates = weekdayDates(year, range[1], range[2], WEEKDAYS.get(weekdayText), whitelist);
    const spec = { title: "ЛЕКЦ. ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ", discipline: "Факультетская терапия, профессиональные болезни", kind: "lecture", footer: row };
    for (let group = groups[0]; group <= groups[1]; group += 1) {
      for (const date of dates) events.push(event(group, date, time, spec, {
        origin: "footer_schedule",
        stream,
        location: `3 корпус, аудитория ${room}, ${row.address}`,
        source: `footer-row-${row.row}`,
      }));
    }
  }
}

function addPhysicalEducation(events, footer, year, whitelist) {
  const row = findFooter(footer, (name) => name.startsWith("элективные дисциплины по физической культуре"));
  if (!row) return;
  const spec = { title: "Элективные дисциплины по физической культуре и спорту", discipline: "Элективные дисциплины по физической культуре и спорту", kind: "physical_education", footer: row };
  const location = `3 корпус, Физкультурно-оздоровительный комплекс, ${row.address}`;
  const configs = [
    { stream: 1, groups: [401, 410], text: row.shift1, weekday: 1 },
    { stream: 2, groups: [411, 420], text: row.shift2, weekday: 3 },
  ];
  for (const config of configs) {
    const range = String(config.text).match(/(\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2})/);
    const time = parseTime(config.text);
    if (!range || !time) continue;
    const dates = weekdayDates(year, range[1], range[2], config.weekday, whitelist);
    for (let group = config.groups[0]; group <= config.groups[1]; group += 1) {
      for (const date of dates) events.push(event(group, date, time, spec, { origin: "footer_schedule", stream: config.stream, location, source: `footer-row-${row.row}` }));
    }
  }
  const extra = String(row.shift1).match(/вторник\s+([\d.,\s]+)\s+(\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})/i);
  if (extra) {
    const time = parseTime(extra[2]);
    const dates = [...extra[1].matchAll(/(\d{2})\.(\d{2})/g)]
      .map((match) => iso(year, { day: Number(match[1]), month: Number(match[2]) }))
      .filter((date) => whitelist.has(date));
    for (let group = 401; group <= 410; group += 1) {
      for (const date of dates) events.push(event(group, date, time, spec, { origin: "footer_schedule", stream: 1, location, source: `footer-row-${row.row}` }));
    }
  }
}

function overlapReport(events) {
  const overlaps = [];
  const byGroupDate = new Map();
  for (const item of events) {
    const date = item.start.slice(0, 10);
    const key = `${item.group}|${date}`;
    if (!byGroupDate.has(key)) byGroupDate.set(key, []);
    byGroupDate.get(key).push(item);
  }
  for (const [key, items] of byGroupDate) {
    const [group, date] = key.split("|");
    const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (Date.parse(sorted[j].start) >= Date.parse(sorted[i].end)) break;
        if (Date.parse(sorted[i].start) < Date.parse(sorted[j].end)) {
          overlaps.push({ group: Number(group), date, first: sorted[i].id, second: sorted[j].id, rule: "C13" });
        }
      }
    }
  }
  return overlaps;
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

export function parseKgmuCycleWorkbook(workbook, metadata = {}) {
  const { sheet, rows, dateRow } = findCycleSheet(workbook);
  const cells = cellMap(sheet);
  const period = resolvePeriod(workbook, metadata);
  const dates = dateColumns(sheet, rows, dateRow, period.eventYear);
  const whitelist = new Set(dates.values());
  const columns = footerColumns(sheet, rows);
  const footer = footerRows(sheet, rows, columns);
  const groupRows = [...rows.entries()]
    .map(([row]) => ({ row, group: Number(clean(effectiveValue(sheet, cells, 2, row))) }))
    .filter((item) => Number.isInteger(item.group) && item.group >= 400 && item.group <= 499);
  const events = [];
  const unhandledBlocks = [];
  let sourceBlocks = 0;

  const firstDateCol = Math.min(...dates.keys());
  const lastDateCol = Math.max(...dates.keys());
  for (const { row, group } of groupRows) {
    for (const cell of rows.get(row) || []) {
      if (cell.col < firstDateCol || cell.col > lastDateCol) continue;
      const text = clean(cell.value);
      if (!text || text === "**" || /^экзамены$/i.test(text)) continue;
      sourceBlocks += 1;
      const spec = mainSpec(text, footer);
      if (!spec) {
        unhandledBlocks.push({ group, cell: cell.ref, text });
        continue;
      }
      const merge = (sheet.merges || []).find((item) => item.startRef === cell.ref && item.startRow === row && item.endRow === row);
      const endCol = merge?.endCol || cell.col;
      const coveredDates = [];
      for (let col = cell.col; col <= endCol; col += 1) if (dates.has(col)) coveredDates.push(dates.get(col));
      for (const [index, date] of coveredDates.entries()) {
        const shift = spec.kind === "project_defense" ? 1 : spec.starred && index === 0 ? 2 : 1;
        const time = timeFor(spec, shift);
        if (!time) {
          unhandledBlocks.push({ group, cell: cell.ref, text, reason: `missing-shift-${shift}-time` });
          break;
        }
        events.push({
          ...event(group, date, time, spec, { origin: "main_grid", shift: spec.kind === "project_defense" ? null : shift, source: cell.ref }),
          group,
        });
      }
    }
  }

  addTherapyLectures(events, footer, period.eventYear, whitelist);
  addPhysicalEducation(events, footer, period.eventYear, whitelist);
  const duplicates = duplicateReport(events);
  const overlaps = overlapReport(events);
  const groupCounts = Object.fromEntries(groupRows.map(({ group }) => [String(group), events.filter((event) => event.group === group).length]));
  const qa = {
    passed: unhandledBlocks.length === 0 && duplicates.length === 0 && sourceBlocks > 0,
    sourceBlocks,
    coveredSourceBlocks: sourceBlocks - unhandledBlocks.length,
    unhandledBlocks,
    duplicateCount: duplicates.length,
    duplicates,
    overlapCount: overlaps.length,
    overlaps,
    eventCount: events.length,
    groupCounts,
  };

  const program = metadata.program || "medicine";
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
    parserQa: {
      sourceBlocks: qa.sourceBlocks,
      coveredSourceBlocks: qa.coveredSourceBlocks,
      duplicateCount: qa.duplicateCount,
      overlapCount: qa.overlapCount,
    },
    group: {
      id: `kgmu:${program}:${course}:${group}`,
      code: String(group),
      displayName: `Группа ${group}`,
    },
    sources: metadata.sourceUrl ? [{ url: metadata.sourceUrl, sha256: metadata.sourceSha256 || null }] : [],
    events: events.filter((event) => event.group === group).map(({ group: _group, ...item }) => item),
  }));

  return { type: "C", schedules, qa };
}
