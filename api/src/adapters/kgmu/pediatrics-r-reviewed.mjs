import { createHash } from "node:crypto";
import { parseWeeklyRWorkbook } from "./weekly-r-parser.mjs";

const ELECTIVE_PE_SENTINEL = "__KGMU_ELECTIVE_PE__";
const ELECTIVE_PE_CANONICAL = "Элективные дисциплины (модули) по физической культуре и спорту";
const ELECTIVE_PE_PATTERN = /элективные\s+дисциплины(?:\s*\(модули\))?\s+по\s+физической\s+культуре\s+и\s+спорту/gi;

// R-PED uses parser-known subjects as internal surrogates only. Restoration is
// keyed by both the surrogate title and the original source cell, so two
// different subjects in one cell cannot collapse into one title.
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
  // Source files sometimes put a harmless space before the closing parenthesis:
  // "(1 занятие во вт. )". Normalize only that whitespace so generic R QA can
  // recognize the already-existing note without changing its meaning.
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
    subject.placeholder === placeholder && patternTest(subject.pattern, raw)
  ))?.canonical || null;
}

function subjectFromQaSource(placeholder, source, originals) {
  const sourceCell = sourceCellFromRange(source);
  const raw = sourceCell ? originals.get(sourceCell) || "" : "";
  return SUBJECT_EXTENSIONS.find((subject) => (
    subject.placeholder === placeholder && patternTest(subject.pattern, raw)
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
          result.push({
            group,
            event1: sorted[i].id,
            event2: sorted[j].id,
            start1: sorted[i].start,
            end1: sorted[i].end,
            start2: sorted[j].start,
            end2: sorted[j].end,
          });
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
    ...(Array.isArray(entry.eventIds) && idMap ? {
      eventIds: entry.eventIds.map((id) => idMap.get(id) || id),
    } : {}),
  };
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
  const extraLessonExpectations = (parsed.qa.extraLessonExpectations || [])
    .map((entry) => restoreQaEntry(entry, originals));
  const extraLessonFailures = (parsed.qa.extraLessonFailures || [])
    .map((entry) => restoreQaEntry(entry, originals, idMap));
  const qa = {
    ...parsed.qa,
    extraLessonExpectations,
    extraLessonFailures,
    remainingOverlaps,
    status: parsed.qa.uncovered.length || extraLessonFailures.length || remainingOverlaps.length
      ? "REVIEW_REQUIRED"
      : "PASS",
    eventCount: events.length,
    eventCountsByGroup: Object.fromEntries(schedules.map((schedule) => [schedule.group.code, schedule.events.length])),
    reviewedProfile: "R-PED-REVIEWED",
  };
  return { schedules, qa };
}
