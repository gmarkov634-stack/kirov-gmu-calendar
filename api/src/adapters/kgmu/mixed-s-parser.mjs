import { createHash } from "node:crypto";

const WEEKDAYS = new Map([
  ["пн", 1], ["понедельник", 1], ["вт", 2], ["вторник", 2],
  ["ср", 3], ["среда", 3], ["чт", 4], ["четверг", 4],
  ["пт", 5], ["пятница", 5], ["сб", 6], ["суббота", 6],
]);
const BUILDINGS = {
  "1": { name: "1 корпус", address: "ул. Владимирская, 137" },
  "2": { name: "2 корпус", address: "ул. Пролетарская, 38" },
  "3": { name: "3 корпус", address: "ул. Владимирская, 112" },
};
const SUBJECTS = [
  ["Учебная практика. Практика по получению первичных профессиональных умений и навыков на должностях среднего медицинского персонала", /учебная\s+практика\.\s*практика\s+по\s+получению\s+первичных\s+профессиональных\s+умений\s+и\s+навыков\s+на\s+должностях\s+среднего\s+медицинского\s+персонала/i],
  ["Учебная практика. Научно-исследовательская работа (получение первичных навыков научно-исследовательской работы)", /учебная\s+практика\.\s*научно-исследовательская\s+работа\s*\(получение\s+первичных\s+навыков\s+научно-исследовательской\s+работы\)/i],
  ["Микробиология, вирусология-микробиология полости рта", /микробиология\s*,\s*вирусология\s*[-–]?\s*микробиология\s+полости\s+рта/i],
  ["Патологическая анатомия - патологическая анатомия головы и шеи", /патологическая\s+анатомия\s*[-–]\s*патологическая\s+анатомия\s+головы\s+и\s+шеи/i],
  ["Патофизиология - патофизиология головы и шеи", /патофизиология\s*[-–]\s*патофизиология\s+головы\s+и\s+шеи/i],
  ["Топографическая анатомия и оперативная хирургия головы и шеи", /топографическая\s+анатомия\s+и\s+оперативная\s+хирургия\s+головы\s+и\s+шеи/i],
  ["Элективные дисциплины по физической культуре и спорту", /элективные\s+дисциплины\s*(?:\(модули\))?\s*по\s+физической\s+культуре\s+и\s+спорту/i],
  ["Иммунология - клиническая иммунология", /имм+унология(?:\s*[-–]\s*клиническая\s+иммунология)?/i],
  ["Пропедевтическая стоматология", /пропедевтическая\s+стоматология/i],
  ["Правоведение", /правоведение/i],
  ["Экономика", /экономика/i],
  ["Философия", /философия/i],
  ["Фармакология", /фармакология/i],
  ["Час куратора", /час\s+куратора/i],
];
const TIME = String.raw`\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}`;
const TIME_BLOCK = new RegExp(String.raw`${TIME}(?:\s*,\s*${TIME})*`, "g");
const DATE_RANGE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_TIME = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)/g;
const DATE_TOKEN = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;

function clean(value) { return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function pad(value) { return String(value).padStart(2, "0"); }
function iso(year, month, day) { return `${year}-${pad(month)}-${pad(day)}`; }
function dateObject(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
}
function weekday(value) { const day = value.getUTCDay(); return day === 0 ? 7 : day; }
function clock(value) {
  const match = String(value).match(/(\d{1,2})[.:](\d{2})/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${pad(match[1])}:${match[2]}`;
}
function timeBlock(value) {
  const parts = [...String(value).matchAll(new RegExp(TIME, "g"))];
  if (!parts.length) return null;
  return { start: clock(parts[0][0]), end: clock(parts.at(-1)[0].split(/[-–]/).at(-1)) };
}
function refFor(col, row) {
  let value = col; let result = "";
  while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return `${result}${row}`;
}
function toDateTime(date, time) { return `${date}T${time}:00+03:00`; }
function eventOverlap(a, b) { return a.start < b.end && b.start < a.end; }

function canonicalSubject(value) {
  const text = clean(value);
  for (const [canonical, pattern] of SUBJECTS) {
    if (new RegExp(`^${pattern.source}$`, pattern.flags).test(text)) return canonical;
  }
  return null;
}
function subjectMatches(text) {
  const matches = [];
  for (const [canonical, pattern] of SUBJECTS) {
    for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      matches.push({ canonical, index: match.index, end: match.index + match[0].length });
    }
  }
  return matches.sort((a, b) => a.index - b.index || b.end - a.end)
    .filter((match, index, all) => !all.slice(0, index).some((other) => match.index >= other.index && match.end <= other.end));
}
function segments(text) {
  const subjects = subjectMatches(text);
  const starts = [];
  let previousEnd = 0;
  for (const subject of subjects) {
    const before = text.slice(previousEnd, subject.index);
    const times = [...before.matchAll(TIME_BLOCK)];
    if (!times.length) { previousEnd = subject.end; continue; }
    const time = times.at(-1);
    const start = previousEnd + time.index;
    const between = text.slice(start + time[0].length, subject.index);
    starts.push({
      start,
      subjectStart: subject.index,
      subjectEnd: subject.end,
      subject: subject.canonical,
      lecture: /лекц(?:ия)?/i.test(between),
      timeRaw: time[0],
    });
    previousEnd = subject.end;
  }
  return starts.map((item, index) => ({
    ...item,
    end: starts[index + 1]?.start ?? text.length,
    raw: text.slice(item.start, starts[index + 1]?.start ?? text.length),
  }));
}

function normalizeDateTypos(value) {
  return String(value).replace(/(?<!\d)(\d{2})(\d{2})(?!\d)/g, (raw, day, month) => {
    const d = Number(day); const m = Number(month);
    return d >= 1 && d <= 31 && m >= 1 && m <= 12 ? `${day}.${month}` : raw;
  });
}
function masked(text, spans) {
  const chars = [...text];
  for (const [start, end] of spans) for (let i = start; i < end; i += 1) chars[i] = " ";
  return chars.join("");
}
function rangeDates(start, end, targetWeekday, holidays) {
  const dates = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = iso(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (weekday(cursor) === targetWeekday && !holidays.has(date)) dates.push(date);
  }
  return dates;
}
function parseOccurrences(tail, year, targetWeekday, holidays, defaultTime) {
  const text = normalizeDateTypos(tail);
  const occurrences = [];
  const spans = [];
  for (const match of text.matchAll(DATE_TIME)) {
    const d = Number(match[1]); const m = Number(match[2]);
    if (!dateObject(year, m, d)) continue;
    const start = `${pad(match[3])}:${match[4]}`; const end = `${pad(match[5])}:${match[6]}`;
    occurrences.push({ date: iso(year, m, d), start, end, index: match.index, mode: "explicit" });
    spans.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(DATE_RANGE)) {
    const sd = Number(match[1]); const sm = Number(match[2]); const ed = Number(match[3]); const em = Number(match[4]);
    const start = dateObject(year, sm, sd); const end = dateObject(year, em, ed);
    if (!start || !end || end < start) continue;
    for (const date of rangeDates(start, end, targetWeekday, holidays)) {
      occurrences.push({ date, ...defaultTime, index: match.index, mode: "range" });
    }
    spans.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(TIME_BLOCK)) spans.push([match.index, match.index + match[0].length]);
  for (const match of masked(text, spans).matchAll(DATE_TOKEN)) {
    const d = Number(match[1]); const m = Number(match[2]);
    if (!dateObject(year, m, d)) continue;
    occurrences.push({ date: iso(year, m, d), ...defaultTime, index: match.index, mode: "explicit" });
  }
  const controlIndex = text.search(/зач[её]т\s+с\s+оценкой/i);
  let controlKey = null;
  if (controlIndex >= 0) {
    const candidate = occurrences.filter((item) => item.index <= controlIndex).sort((a, b) => b.index - a.index)[0];
    if (candidate) controlKey = `${candidate.date}|${candidate.index}`;
  }
  const unique = new Map();
  for (const item of occurrences) {
    const key = `${item.date}|${item.index}`;
    unique.set(`${item.date}|${item.start}|${item.end}`, { ...item, control: key === controlKey });
  }
  return { text, occurrences: [...unique.values()], controlIndex };
}

function normalizeAssessment(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (text.includes("экзамен")) return "экзамен";
  if (text.includes("с оценкой")) return "зачет с оценкой";
  if (text.includes("зач")) return "зачет";
  return clean(value);
}
function buildingLocation(number, room = null) {
  const building = BUILDINGS[number];
  if (!building) return "";
  return room ? `${building.name}, аудитория ${room}, ${building.address}` : `${building.name}, ${building.address}`;
}
function footerLocation(subject, department, practiceBase) {
  const base = clean(practiceBase);
  if (base) return base.replace(/"([^\"]+)"/g, "«$1»");
  const dept = clean(department);
  if (subject === "Элективные дисциплины по физической культуре и спорту" || /\bфок\b/i.test(dept)) return "ФОК, ул. Владимирская, 112";
  if (subject === "Пропедевтическая стоматология") {
    const match = dept.match(/\((Консультативно-диагностическое отделение[\s\S]*?ул\.\s*Никитская\s*,\s*167)\)/i);
    if (match) return clean(match[1]).replace(/\s*,\s*/g, ", ");
  }
  const building = dept.match(/([123])\s*кор(?:пус|ус)/i);
  return building ? buildingLocation(building[1]) : "";
}
function footerMetadata(sheet) {
  const values = new Map(sheet.cells.map((cell) => [cell.ref, cell.value]));
  const header = sheet.cells.find((cell) => cell.col === 1 && /^дисциплина$/i.test(clean(cell.value)));
  const result = new Map();
  if (!header) return result;
  for (let row = header.row + 1; row <= header.row + 20; row += 1) {
    const raw = values.get(refFor(1, row));
    if (!raw) continue;
    const subject = canonicalSubject(raw);
    if (!subject || subject === "Час куратора") continue;
    const department = values.get(refFor(3, row));
    const practiceBase = values.get(refFor(4, row));
    const assessment = normalizeAssessment(values.get(refFor(5, row)));
    result.set(subject, { subject, assessment, location: footerLocation(subject, department, practiceBase) });
  }
  return result;
}
function roomInfo(text) {
  const dateRooms = new Map();
  for (const match of text.matchAll(/(?<!\d)(\d{1,2}\.\d{2})\s*-\s*([123])-(\d{3})(?!\d)/g)) {
    dateRooms.set(match[1], buildingLocation(match[2], match[3]));
  }
  const rooms = [...text.matchAll(/(?<!\d)([123])-(\d{3})(?!\d)/g)].map((match) => buildingLocation(match[1], match[2]));
  return { dateRooms, common: [...new Set(rooms)].length === 1 ? rooms[0] : "" };
}
function locationForOccurrence(info, occurrence, fallback) {
  const token = `${Number(occurrence.date.slice(8))}.${occurrence.date.slice(5, 7)}`;
  const padded = `${occurrence.date.slice(8)}.${occurrence.date.slice(5, 7)}`;
  return info.dateRooms.get(padded) || info.dateRooms.get(token) || info.common || fallback || "";
}
function makeEvent({ group, subject, occurrence, location, assessment, source, kind }) {
  const title = kind === "lecture" ? `ЛЕКЦ. ${subject.toUpperCase()}`
    : kind === "control" ? `ЗАЧЕТ С ОЦЕНКОЙ — ${subject.toUpperCase()}` : subject;
  const start = toDateTime(occurrence.date, occurrence.start); const end = toDateTime(occurrence.date, occurrence.end);
  const id = createHash("sha1").update([group, title, start, end, source].join("|")).digest("hex").slice(0, 18);
  return { id: `kgmu-${group}-${id}`, title, start, end, location, assessment: assessment || null, sourceType: "kgmu-xlsx", source, sourceRange: source, subject, kind, dateMode: occurrence.mode };
}

function parseHeaderPeriod(sheet) {
  const text = sheet.cells.map((cell) => clean(cell.value)).join(" ");
  const match = text.match(/(\d{1,2})\.(\d{2})\.(20\d{2}).*?[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);
  if (!match) return { year: 2026, start: dateObject(2026, 2, 2), end: dateObject(2026, 6, 8) };
  return { year: Number(match[3]), start: dateObject(Number(match[3]), Number(match[2]), Number(match[1])), end: dateObject(Number(match[6]), Number(match[5]), Number(match[4])) };
}
function holidays(sheet, year) {
  const result = new Set();
  const cell = sheet.cells.find((item) => /праздничные\s+неучебные\s+дни/i.test(clean(item.value)));
  if (!cell) return result;
  const text = clean(cell.value).slice(clean(cell.value).search(/праздничные/i));
  for (const match of text.matchAll(DATE_TOKEN)) {
    if (dateObject(year, Number(match[2]), Number(match[1]))) result.add(iso(year, Number(match[2]), Number(match[1])));
  }
  return result;
}
function groupHeader(sheet) {
  let best = { row: 0, groups: [] };
  const rows = new Map();
  for (const cell of sheet.cells) { if (!rows.has(cell.row)) rows.set(cell.row, []); rows.get(cell.row).push(cell); }
  for (const [row, cells] of rows) {
    const groups = cells.map((cell) => {
      const match = clean(cell.value).match(/^группа\s*(\d{3})$/i);
      return match ? { code: match[1], col: cell.col } : null;
    }).filter(Boolean);
    if (groups.length > best.groups.length) best = { row, groups };
  }
  return best;
}
function weekdayRows(sheet, firstRow, lastRow) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const day = WEEKDAYS.get(clean(cell.value).toLowerCase());
    if (!day) continue;
    const merge = sheet.merges.find((item) => item.startRow === cell.row && item.startCol === 1);
    for (let row = Math.max(firstRow, merge?.startRow ?? cell.row); row <= Math.min(lastRow, merge?.endRow ?? cell.row); row += 1) result.set(row, day);
  }
  return result;
}
function anchors(sheet, header, lastRow, dayRows) {
  const result = [];
  for (const cell of sheet.cells) {
    if (cell.row <= header.row || cell.row > lastRow || cell.col < 2 || cell.col > 5 || !cell.value) continue;
    const containing = sheet.merges.find((merge) => cell.row >= merge.startRow && cell.row <= merge.endRow && cell.col >= merge.startCol && cell.col <= merge.endCol);
    if (containing && (containing.startRow !== cell.row || containing.startCol !== cell.col)) continue;
    const merge = sheet.merges.find((item) => item.startRow === cell.row && item.startCol === cell.col);
    const startCol = merge?.startCol ?? cell.col; const endCol = merge?.endCol ?? cell.col;
    const groups = header.groups.filter((group) => group.col >= startCol && group.col <= endCol).map((group) => group.code);
    if (!groups.length) continue;
    result.push({ cell, merge, groups, weekday: dayRows.get(cell.row), source: merge?.ref || cell.ref });
  }
  return result;
}
function noteExpectations(anchor, parsedSegments) {
  const result = [];
  for (const segment of parsedSegments) {
    const match = segment.raw.match(/\((\d+)\s+занят(?:ие|ия)?\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\)/i);
    if (!match) continue;
    for (const group of anchor.groups) result.push({ group, subject: segment.subject, count: Number(match[1]), weekday: WEEKDAYS.get(match[2].toLowerCase()), source: anchor.source });
  }
  return result;
}
function parseAnchor(anchor, meta, year, holidaySet) {
  const text = clean(anchor.cell.value); const parsed = segments(text); const events = []; const curators = [];
  if (!anchor.weekday || !parsed.length) return { events, curators, expectations: [], covered: false };
  const expectations = noteExpectations(anchor, parsed);
  for (const group of anchor.groups) {
    for (const segment of parsed) {
      const defaultTime = timeBlock(segment.timeRaw);
      if (!defaultTime) continue;
      if (segment.subject === "Час куратора") {
        curators.push({ group, weekday: anchor.weekday, time: defaultTime, source: anchor.source });
        continue;
      }
      const subjectMeta = meta.get(segment.subject) || {};
      const tail = segment.raw.slice(segment.subjectEnd - segment.start);
      const parsedOccurrences = parseOccurrences(tail, year, anchor.weekday, holidaySet, defaultTime);
      const rooms = roomInfo(parsedOccurrences.text);
      for (const occurrence of parsedOccurrences.occurrences) {
        events.push(makeEvent({
          group,
          subject: segment.subject,
          occurrence,
          location: locationForOccurrence(rooms, occurrence, subjectMeta.location),
          assessment: subjectMeta.assessment,
          source: anchor.source,
          kind: occurrence.control ? "control" : segment.lecture ? "lecture" : "practical",
        }));
      }
    }
  }
  return { events, curators, expectations, covered: events.length > 0 || curators.length > 0 };
}

function cycleEvents(sheet, meta, holidaySet) {
  const result = []; const covered = [];
  for (const cell of sheet.cells.filter((item) => item.col === 1 && /^29[1-4]$/.test(String(item.value)))) {
    if (cell.row < 50 || cell.row > 53) continue;
    const group = String(cell.value); const text = clean(sheet.cells.find((item) => item.row === cell.row && item.col === 2)?.value);
    const match = text.match(/(\d{1,2})\.(\d{2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);
    if (!match) continue;
    const start = dateObject(Number(match[3]), Number(match[2]), Number(match[1]));
    const end = dateObject(Number(match[6]), Number(match[5]), Number(match[4]));
    if (!start || !end) continue;
    const source = `cycle-${group}`; const subject = "Пропедевтическая стоматология"; const subjectMeta = meta.get(subject) || {};
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (weekday(cursor) === 7) continue;
      const date = iso(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
      if (holidaySet.has(date)) continue;
      const specialThursday = /по\s+четвергам\s+13[.:]30\s*[-–]\s*17[.:]35/i.test(text) && weekday(cursor) === 4;
      result.push(makeEvent({ group, subject, occurrence: { date, start: specialThursday ? "13:30" : "13:00", end: specialThursday ? "17:35" : "17:05", mode: "cycle" }, location: subjectMeta.location, assessment: subjectMeta.assessment, source, kind: "cycle" }));
    }
    covered.push(source);
  }
  return { events: result, covered };
}
function resolveCurators(requests, events, semester, holidaySet) {
  const result = [];
  for (const request of requests) {
    const existing = [...events, ...result].filter((event) => event.group === request.group);
    const candidates = rangeDates(semester.start, semester.end, request.weekday, holidaySet);
    for (const date of candidates) {
      const candidate = makeEvent({ group: request.group, subject: "Час куратора", occurrence: { date, ...request.time, mode: "derived" }, location: "", assessment: null, source: request.source, kind: "curator" });
      if (existing.some((event) => event.start.slice(0, 10) === date && eventOverlap(candidate, event))) continue;
      result.push(candidate); existing.push(candidate);
      if (result.filter((event) => event.group === request.group && event.source === request.source).length === 2) break;
    }
  }
  return result;
}
function dedupe(events) {
  const seen = new Set(); const result = [];
  for (const event of events) {
    const key = [event.group, event.start, event.end, event.title, event.location].join("|");
    if (seen.has(key)) continue; seen.add(key); result.push(event);
  }
  return result;
}
function validateExpectations(events, expectations) {
  const failures = [];
  for (const expected of expectations) {
    const matches = events.filter((event) => event.group === expected.group && event.subject === expected.subject && event.source !== expected.source && event.kind !== "lecture" && event.dateMode === "explicit" && weekday(new Date(`${event.start.slice(0, 10)}T12:00:00Z`)) === expected.weekday);
    if (matches.length !== expected.count) failures.push({ ...expected, actual: matches.length, eventIds: matches.map((event) => event.id) });
  }
  return failures;
}
function overlaps(events) {
  const allowed = []; const unexpected = [];
  const byGroup = new Map();
  for (const event of events) { if (!byGroup.has(event.group)) byGroup.set(event.group, []); byGroup.get(event.group).push(event); }
  for (const [group, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].start.slice(0, 10) !== sorted[i].start.slice(0, 10) || sorted[j].start >= sorted[i].end) break;
      if (!eventOverlap(sorted[i], sorted[j])) continue;
      const item = { group, date: sorted[i].start.slice(0, 10), event1: sorted[i].id, event2: sorted[j].id };
      if (sorted[i].kind === "cycle" || sorted[j].kind === "cycle") allowed.push(item); else unexpected.push(item);
    }
  }
  return { allowed, unexpected };
}

export function parseKgmuMixedWorkbook(workbook, { program = "dentistry", course = 2, academicYear = "2025/26", semester = 2 } = {}) {
  const sheet = workbook?.sheets?.[0]; if (!sheet) throw new Error("Workbook has no worksheet");
  const header = groupHeader(sheet); if (header.groups.length !== 4) throw new Error("Mixed schedule group header not found");
  const cycleHeader = sheet.cells.find((cell) => cell.col === 1 && /расписание\s+занятий\s+цикла/i.test(clean(cell.value)));
  if (!cycleHeader) throw new Error("Embedded dentistry cycle table not found");
  const semesterWindow = parseHeaderPeriod(sheet); const holidaySet = holidays(sheet, semesterWindow.year); const meta = footerMetadata(sheet);
  const dayRows = weekdayRows(sheet, header.row + 1, cycleHeader.row - 2);
  const sourceAnchors = anchors(sheet, header, cycleHeader.row - 2, dayRows);
  const weeklyEvents = []; const curatorRequests = []; const expectations = []; const uncovered = [];
  for (const anchor of sourceAnchors) {
    const parsed = parseAnchor(anchor, meta, semesterWindow.year, holidaySet);
    weeklyEvents.push(...parsed.events); curatorRequests.push(...parsed.curators); expectations.push(...parsed.expectations);
    if (!parsed.covered) uncovered.push({ source: anchor.source, text: clean(anchor.cell.value) });
  }
  const cycle = cycleEvents(sheet, meta, holidaySet);
  const baseEvents = dedupe([...weeklyEvents, ...cycle.events]);
  const curatorEvents = resolveCurators(curatorRequests, baseEvents, semesterWindow, holidaySet);
  const events = dedupe([...baseEvents, ...curatorEvents]);
  const expectationFailures = validateExpectations(events, expectations); const overlapCheck = overlaps(events);
  const groups = header.groups.map((item) => item.code); const schedules = groups.map((group) => ({
    version: 1, university: "kgmu", universityName: "КГМУ", program, course, academicYear, semester, timezone: "Europe/Moscow",
    group: { id: `kgmu:${program}:${course}:${group}`, code: group, displayName: `Группа ${group}` }, sources: [],
    events: events.filter((event) => event.group === group).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)),
  }));
  const sourceBlockCount = sourceAnchors.length + 4; const coveredSourceBlocks = sourceBlockCount - uncovered.length;
  const duplicateCount = weeklyEvents.length + cycle.events.length + curatorEvents.length - events.length;
  const qa = {
    passed: uncovered.length === 0 && expectationFailures.length === 0 && overlapCheck.unexpected.length === 0 && duplicateCount === 0,
    eventCount: events.length, sourceBlocks: sourceBlockCount, coveredSourceBlocks, uncovered, duplicateCount,
    overlapCount: overlapCheck.allowed.length + overlapCheck.unexpected.length, allowedOverlaps: overlapCheck.allowed, unexpectedOverlaps: overlapCheck.unexpected,
    extraLessonExpectations: expectations, extraLessonFailures: expectationFailures,
    groupCounts: Object.fromEntries(schedules.map((schedule) => [schedule.group.code, schedule.events.length])),
  };
  return { schedules, qa };
}
