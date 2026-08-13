import { createHash } from "node:crypto";
import { parseWeeklyRWorkbook } from "./weekly-r-parser.mjs";

const ELECTIVE_PE_SENTINEL = "__KGMU_ELECTIVE_PE__";
const ELECTIVE_PE_CANONICAL = "Элективные дисциплины (модули) по физической культуре и спорту";
const ELECTIVE_PE_PATTERN = /элективные\s+дисциплины(?:\s*\(модули\))?\s+по\s+физической\s+культуре\s+и\s+спорту/gi;

const SUBJECT_EXTENSIONS = [
  { canonical: "Биоэтика", placeholder: "Философия", pattern: /биоэтика/i },
  { canonical: "Психология и педагогика", placeholder: "Правоведение", pattern: /психология\s+и\s+педагогика/i },
  { canonical: "Гигиена", placeholder: "Фармакология", pattern: /(?<!микробиология\s*,\s*вирусология\s*,\s*)гигиена/i },
  { canonical: "Основы формирования здоровья детей", placeholder: "История России", pattern: /основы\s+формирования\s+здоровья\s+детей/i },
  { canonical: "Общая хирургия", placeholder: "История медицины", pattern: /общая\s+хирургия/i },
  { canonical: "Нормальная физиология", placeholder: "Медицинская информатика", pattern: /нормальная\s+физиология/i },
  { canonical: "Физическая культура и спорт", placeholder: "Безопасность жизнедеятельности", pattern: /физическая\s+культура\s+и\s+спорт/i },
  { canonical: "Микробиология, вирусология", placeholder: "Латинский язык", pattern: /микробиология\s*,\s*вирусология(?!\s*[-–]\s*микробиология\s+полости\s+рта)/i },
  { canonical: "Биохимия", placeholder: "Иностранный язык", pattern: /биохимия/i },
  { canonical: "Пропедевтика внутренних болезней", placeholder: "Общая и биоорганическая химия", pattern: /пропедевтика\s+внутренних\s+болезней/i },
  { canonical: "Иммунология", placeholder: "Биология", pattern: /иммунология(?!\s*[-–]\s*клиническая\s+иммунология)/i },
];

const SOURCE_SUBJECTS = [
  ...SUBJECT_EXTENSIONS.map(({ canonical, pattern }) => ({ canonical, pattern })),
  { canonical: "Философия", pattern: /философия/i },
  { canonical: "Экономика", pattern: /(?<!здравоохранения\s*,\s*)экономика(?!\s+здравоохранения)/i },
  { canonical: ELECTIVE_PE_CANONICAL, pattern: /элективные\s+дисциплины(?:\s*\(модули\))?\s+по\s+физической\s+культуре\s+и\s+спорту/i },
  { canonical: "Фармакология", pattern: /фармакология/i },
  { canonical: "История России", pattern: /история\s+россии/i },
  { canonical: "История медицины", pattern: /история\s+медицины/i },
  { canonical: "Медицинская информатика", pattern: /медицинская\s+информатика/i },
  { canonical: "Безопасность жизнедеятельности", pattern: /безопасность\s+жизнедеятельности/i },
  { canonical: "Иностранный язык", pattern: /иностранный\s+язык/i },
  { canonical: "Латинский язык", pattern: /латинский\s+язык/i },
  { canonical: "Биология", pattern: /(?<!микро)биология/i },
];

const WEEKDAY_NUMBERS = { пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6 };

const BUILDINGS = {
  "1": { building: "1 корпус", address: "ул. Владимирская, 137" },
  "2": { building: "2 корпус", address: "ул. Пролетарская, 38" },
  "3": { building: "3 корпус", address: "ул. Владимирская, 112" },
};

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function globalPattern(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function patternTest(pattern, value) {
  return new RegExp(pattern.source, pattern.flags.replace(/g/g, "")).test(clean(value));
}

function sameSubject(a, b) {
  return clean(a).toLocaleLowerCase("ru") === clean(b).toLocaleLowerCase("ru");
}

function refTextMap(workbook) {
  return new Map((workbook?.sheets?.[0]?.cells || []).map((cell) => [cell.ref, String(cell.value ?? "")]));
}

function sourceCellFromRange(source) {
  return clean(source).split(":")[0] || null;
}

function replaceExtendedSubjects(value) {
  let text = String(value ?? "");
  const shouldTransform = /\d{1,2}[.:]\d{2}/.test(text)
    || SUBJECT_EXTENSIONS.some((subject) => patternTest(subject.pattern, text) && clean(text).length < 120);
  if (!shouldTransform) return text;

  text = text.replace(ELECTIVE_PE_PATTERN, ELECTIVE_PE_SENTINEL);
  for (const subject of SUBJECT_EXTENSIONS) {
    text = text.replace(globalPattern(subject.pattern), subject.placeholder);
  }
  text = text.replaceAll(ELECTIVE_PE_SENTINEL, ELECTIVE_PE_CANONICAL);
  return text.replace(/(\b(?:пн|вт|ср|чт|пт|сб)\.?)\s+\)/gi, "$1)");
}

function productionWorkbook(workbook) {
  return {
    ...workbook,
    sheets: (workbook?.sheets || []).map((sheet) => ({
      ...sheet,
      cells: (sheet.cells || [])
        .filter((cell) => clean(cell.value) !== "")
        .map((cell) => ({ ...cell, value: replaceExtendedSubjects(cell.value) })),
    })),
  };
}

function inferredScheduleEndRow(workbook) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet?.cells?.length) return null;
  const boundary = sheet.cells
    .filter((cell) => cell.col === 1 && /^(?:факультативы|дисциплина)$/i.test(clean(cell.value)))
    .sort((a, b) => a.row - b.row)[0];
  if (boundary?.row > 1) return boundary.row - 1;
  const maxRow = Math.max(...sheet.cells.map((cell) => cell.row));
  const lastDay = sheet.cells.find((cell) => cell.row === maxRow && cell.col === 1);
  return /^(?:пн|вт|ср|чт|пт|сб|понедельник|вторник|среда|четверг|пятница|суббота)$/i.test(clean(lastDay?.value))
    ? maxRow
    : null;
}

function parserSubjectFromEvent(event) {
  const title = clean(event?.title);
  if (event?.kind === "lecture") return title.replace(/^ЛЕКЦ\.\s*/i, "");
  if (event?.kind === "control") return title.replace(/^ЗАЧЕТ\s+С\s+ОЦЕНКОЙ\s*[—-]\s*/i, "");
  return title;
}

function subjectFromEventSource(event, raw) {
  const placeholder = parserSubjectFromEvent(event);
  return SUBJECT_EXTENSIONS.find((subject) => (
    sameSubject(subject.placeholder, placeholder) && patternTest(subject.pattern, raw)
  ))?.canonical || null;
}

function subjectFromQaSource(placeholder, source, originals) {
  const sourceCell = sourceCellFromRange(source);
  const raw = sourceCell ? originals.get(sourceCell) || "" : "";
  return SUBJECT_EXTENSIONS.find((subject) => (
    sameSubject(subject.placeholder, placeholder) && patternTest(subject.pattern, raw)
  ))?.canonical || placeholder;
}

function restoredTitle(event, subject) {
  if (!subject) return event.title;
  if (event.kind === "lecture") return `ЛЕКЦ. ${subject.toUpperCase()}`;
  if (event.kind === "control") return `ЗАЧЕТ С ОЦЕНКОЙ — ${subject.toUpperCase()}`;
  return subject;
}

function canonicalLocation(location) {
  const text = clean(location);
  const match = text.match(/^([123])\s*корпус(?:,\s*аудитория\s*(\d{3}))?(?:,\s*ул\.[^,]+,\s*\d+)?$/i);
  if (!match) return location;
  const info = BUILDINGS[match[1]];
  if (!info) return location;
  return match[2]
    ? `${info.building}, аудитория ${match[2]}, ${info.address}`
    : `${info.building}, ${info.address}`;
}

function clock(hour, minute) {
  const h = Number(hour), m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dateKey(day, month, year) {
  const d = Number(day), m = Number(month);
  const value = new Date(Date.UTC(year, m - 1, d));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== m - 1 || value.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function inlineExtraTimes(raw, year) {
  const map = new Map();
  const phrase = /\((\d+)\s+занят(?:ие|ия)\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\s+([^)]*?)\)/gi;
  for (const match of String(raw || "").matchAll(phrase)) {
    const details = match[3] || "";
    const times = [...details.matchAll(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/g)];
    if (!times.length) continue;
    const tm = times.at(-1);
    const start = clock(tm[1], tm[2]);
    const end = clock(tm[3], tm[4]);
    if (!start || !end) continue;
    const beforeTime = details.slice(0, tm.index);
    const dates = [...beforeTime.matchAll(/(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g)]
      .map((item) => dateKey(item[1], item[2], year))
      .filter(Boolean);
    if (dates.length !== Number(match[1])) continue;
    for (const date of dates) map.set(date, { start, end });
  }
  return map;
}

function assessmentTimes(raw, year) {
  const map = new Map();
  const re = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–—:]?\s*зач[её]т\s+с\s+оценкой\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)/gi;
  for (const match of String(raw || "").matchAll(re)) {
    const date = dateKey(match[1], match[2], year);
    const start = clock(match[3], match[4]);
    const end = clock(match[5], match[6]);
    if (date && start && end) map.set(date, { start, end });
  }
  return map;
}

function eventId(event) {
  const date = event.start.slice(0, 10);
  const start = event.start.slice(11, 16);
  const hash = createHash("sha1").update([
    event.group,
    date,
    start,
    event.end.slice(11, 16),
    event.title,
    event.sourceCell,
    event.sourceRange,
  ].join("|")).digest("hex").slice(0, 16);
  return `kgmu-${event.group}-${date}-${start.replace(":", "")}-${hash}`;
}

function repairEvent(event, originals) {
  const raw = originals.get(event.sourceCell) || "";
  const subject = subjectFromEventSource(event, raw);
  let next = {
    ...event,
    title: restoredTitle(event, subject),
    location: canonicalLocation(event.location),
  };
  const date = next.start.slice(0, 10);
  const year = Number(date.slice(0, 4));
  const extra = inlineExtraTimes(raw, year).get(date);
  const assessment = assessmentTimes(raw, year).get(date);
  const override = assessment || extra;
  if (override) {
    next = {
      ...next,
      start: `${date}T${override.start}:00+03:00`,
      end: `${date}T${override.end}:00+03:00`,
      ...(assessment ? {
        kind: "control",
        title: `ЗАЧЕТ С ОЦЕНКОЙ — ${(subject || next.title.replace(/^ЗАЧЕТ С ОЦЕНКОЙ — /, "")).toUpperCase()}`,
      } : {}),
    };
  }
  return { ...next, id: eventId(next) };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function findOverlaps(events) {
  const byGroup = new Map();
  for (const event of events) {
    if (!byGroup.has(event.group)) byGroup.set(event.group, []);
    byGroup.get(event.group).push(event);
  }
  const result = [];
  for (const [group, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].start.slice(0, 10) !== sorted[i].start.slice(0, 10)) break;
        if (sorted[j].start >= sorted[i].end) break;
        if (overlaps(sorted[i], sorted[j])) {
          result.push({ group, event1: sorted[i].id, event2: sorted[j].id, start1: sorted[i].start, end1: sorted[i].end, start2: sorted[j].start, end2: sorted[j].end });
        }
      }
    }
  }
  return result;
}

function restoreQaEntry(entry, originals, idMap = null) {
  return {
    ...entry,
    subject: subjectFromQaSource(entry.subject, entry.source, originals),
    ...(Array.isArray(entry.eventIds) && idMap ? { eventIds: entry.eventIds.map((id) => idMap.get(id) || id) } : {}),
  };
}

function groupColumns(sheet) {
  const result = new Map();
  for (const cell of sheet?.cells || []) {
    const match = clean(cell.value).match(/^группа\s+(\d{3}[а-яa-z]?)$/i);
    if (match) result.set(cell.col, match[1]);
  }
  return result;
}

function sourceRangeForCell(sheet, cell) {
  const merge = (sheet?.merges || []).find((item) => item.startRef === cell.ref);
  return merge?.ref || cell.ref;
}

function groupsForCell(sheet, cell, columns) {
  const merge = (sheet?.merges || []).find((item) => item.startRef === cell.ref);
  const startCol = merge?.startCol ?? cell.col;
  const endCol = merge?.endCol ?? cell.col;
  return [...columns.entries()]
    .filter(([col]) => col >= startCol && col <= endCol)
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group);
}

function subjectBefore(text, index) {
  let best = null;
  for (const subject of SOURCE_SUBJECTS) {
    const re = globalPattern(subject.pattern);
    for (const match of String(text || "").matchAll(re)) {
      if (match.index >= index) continue;
      if (!best || match.index > best.index || (match.index === best.index && match[0].length > best.length)) {
        best = { index: match.index, length: match[0].length, subject: subject.canonical };
      }
    }
  }
  return best?.subject || null;
}

function r67SupplementalExpectations(workbook, scheduleEndRow) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return [];
  const columns = groupColumns(sheet);
  if (!columns.size) return [];
  const groupHeaderRow = Math.min(...(sheet.cells || [])
    .filter((cell) => columns.has(cell.col) && /^группа\s+/i.test(clean(cell.value)))
    .map((cell) => cell.row));
  const endRow = Number(scheduleEndRow) || Math.max(...(sheet.cells || []).map((cell) => cell.row));
  const note = /\((\d+)\s+(занят(?:ие|ия|ий)|лекц(?:ия|ии|ий))\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\s*([^)]*)\)/gi;
  const result = [];

  for (const cell of sheet.cells || []) {
    if (cell.row <= groupHeaderRow || cell.row > endRow) continue;
    const groups = groupsForCell(sheet, cell, columns);
    if (!groups.length) continue;
    const raw = String(cell.value || "");
    for (const match of raw.matchAll(note)) {
      // R67 is supplemental only for count/day notes that do not themselves
      // contain concrete dates. Explicit dates stay under R07-R09/R28.
      if (/\b\d{1,2}\.\d{2}\b/.test(match[4] || "")) continue;
      const subject = subjectBefore(raw, match.index);
      if (!subject) continue;
      const count = Number(match[1]);
      const weekday = WEEKDAY_NUMBERS[String(match[3] || "").toLowerCase()];
      if (!Number.isInteger(count) || count < 1 || !weekday) continue;
      const source = sourceRangeForCell(sheet, cell);
      for (const group of groups) {
        result.push({
          group,
          subject,
          count,
          weekday,
          source,
          supplementalR67: true,
          lessonKind: /^лекц/i.test(match[2]) ? "lecture" : "lesson",
        });
      }
    }
  }
  return result;
}

function qaExpectationKey(entry) {
  return [entry.group, clean(entry.subject).toLocaleLowerCase("ru"), Number(entry.count), Number(entry.weekday), entry.source].join("|");
}

export function parsePediatricsRWorkbookReviewed(workbook, options = {}) {
  const originals = refTextMap(workbook);
  const transformed = productionWorkbook(workbook);
  const inferredEnd = options.scheduleEndRow ?? inferredScheduleEndRow(workbook);
  const parsed = parseWeeklyRWorkbook(transformed, {
    ...options,
    ...(inferredEnd ? { scheduleEndRow: inferredEnd } : {}),
  });

  const idMap = new Map();
  const schedules = parsed.schedules.map((schedule) => ({
    ...schedule,
    events: schedule.events.map((event) => {
      const repaired = repairEvent(event, originals);
      idMap.set(event.id, repaired.id);
      return repaired;
    }).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)),
  }));
  const events = schedules.flatMap((schedule) => schedule.events);
  const remainingOverlaps = findOverlaps(events);

  const coreExpectations = (parsed.qa.extraLessonExpectations || []).map((entry) => restoreQaEntry(entry, originals));
  const coreFailures = (parsed.qa.extraLessonFailures || []).map((entry) => restoreQaEntry(entry, originals, idMap));
  const knownExpectationKeys = new Set(coreExpectations.map(qaExpectationKey));
  const supplemental = r67SupplementalExpectations(workbook, inferredEnd)
    .filter((entry) => !knownExpectationKeys.has(qaExpectationKey(entry)));
  const supplementalFailures = supplemental.map((entry) => ({
    ...entry,
    actual: 0,
    eventIds: [],
  }));

  const extraLessonExpectations = [...coreExpectations, ...supplemental];
  const extraLessonFailures = [...coreFailures, ...supplementalFailures];
  const qa = {
    ...parsed.qa,
    extraLessonExpectations,
    extraLessonFailures,
    // R69: temporal overlaps are preserved from the source and remain visible
    // for diagnostics, but they are not an error, warning, or review trigger.
    remainingOverlaps,
    status: parsed.qa.uncovered.length || extraLessonFailures.length ? "REVIEW_REQUIRED" : "PASS",
    eventCount: events.length,
    eventCountsByGroup: Object.fromEntries(schedules.map((schedule) => [schedule.group.code, schedule.events.length])),
    reviewedProfile: "R-PED-REVIEWED",
  };
  return { schedules, qa };
}
