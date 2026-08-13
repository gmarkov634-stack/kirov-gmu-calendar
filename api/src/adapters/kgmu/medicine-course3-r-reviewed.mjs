import { parseWeeklyRWorkbookReviewed } from './weekly-r-reviewed.mjs';

const CLOCK = String.raw`(?:[01]?\d|2[0-3])[.:][0-5]\d`;
const TIME = String.raw`${CLOCK}\s*[-–]\s*${CLOCK}`;
const TIME_BLOCK = String.raw`${TIME}(?:\s*,\s*${TIME})*`;
const DATE = String.raw`\d{1,2}\.\d{2}`;

const SUBJECT_PATTERNS = [
  String.raw`патофизиология\s*,\s*клиническая\s+патофизиология\.\s*патофизиология\s*\(модуль\)`,
  String.raw`патологическая\s+анатомия\s*,\s*клиническая\s+патологическая\s+анатомия\.\s*патологическая\s+анатомия\s*\(модуль\)`,
  String.raw`общая\s+хирургия`,
  String.raw`лучевая\s+диагностика\s+и\s+терапия`,
  String.raw`пропедевтика\s+внутренних\s+болезней`,
  String.raw`организация\s+сестринской\s+помощи(?:\s*\(дисциплина\s+по\s+выбору\))?`,
  String.raw`о?общественное\s+здоровье\s+и\s+здравоохранение\s*,\s*экономика\s+здравоохранения`,
  String.raw`инклюзивно\s+ориентированная\s+компетент(?:ность|ость)\s+врача`,
  String.raw`фармакология`,
  String.raw`элективн(?:ая|ые)\s+дисциплин(?:а|ы)(?:\s*\(модули\))?\s+по\s+физической\s+культуре\s+и\s+спорту`,
];

// Historical source-backed overlaps confirmed against
// 3_lech._2_potok-12-02-2026-11.xlsx are kept in a separate diagnostic bucket.
// R69 no longer requires individual confirmation: any other temporal overlap
// also remains diagnostic-only and never triggers REVIEW_REQUIRED by itself.
const CONFIRMED_OVERLAPS_2025_26 = [
  { group: '311', date: '2026-05-25', a: ['B7', '08:00', '11:10'], b: ['B8:J8', '11:00', '12:30'] },
  { group: '311', date: '2026-05-25', a: ['B7', '08:00', '11:10'], b: ['B11', '11:00', '12:30'] },
  { group: '311', date: '2026-05-25', a: ['B8:J8', '11:00', '12:30'], b: ['B11', '11:00', '12:30'] },
  { group: '312', date: '2026-05-20', a: ['C17', '10:40', '13:50'], b: ['C18', '13:00', '16:10'] },
  { group: '313', date: '2026-05-25', a: ['D7', '08:00', '11:10'], b: ['B8:J8', '11:00', '12:30'] },
  { group: '319', date: '2026-05-18', a: ['J7', '08:00', '11:10'], b: ['B8:J8', '11:00', '12:30'] },
  { group: '319', date: '2026-05-25', a: ['J7', '08:00', '11:10'], b: ['B8:J8', '11:00', '12:30'] },
];

function cloneWorkbook(workbook) {
  return {
    ...workbook,
    sheets: (workbook?.sheets || []).map((sheet) => ({
      ...sheet,
      cells: (sheet.cells || []).map((cell) => ({ ...cell })),
      merges: (sheet.merges || []).map((merge) => ({ ...merge })),
      styledCells: (sheet.styledCells || []).map((cell) => ({ ...cell })),
      hiddenRows: [...(sheet.hiddenRows || [])],
    })),
  };
}

function normalizeAdjacentTimes(text) {
  const source = String(text || '');
  const adjacent = new RegExp(String.raw`(${TIME})\s+(${TIME})(?=\s+[А-ЯЁ])`, 'g');
  return source.replace(adjacent, (whole, first, second, offset, original) => {
    const prefix = original.slice(Math.max(0, offset - 16), offset);
    // R68: if the first interval is linked to a date on its left, it belongs to
    // that atomic date-time-time triple. Do not join the following independent
    // interval to it, otherwise the date can leak into the next subject segment.
    if (/\d{1,2}\.\d{2}\s*[-–]\s*$/.test(prefix)) return whole;
    return `${first}, ${second}`;
  });
}

function validDateParts(day, month) {
  return Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12;
}

function validClockParts(hour, minute) {
  return Number(hour) >= 0 && Number(hour) <= 23 && Number(minute) >= 0 && Number(minute) <= 59;
}

function clockMinutes(hour, minute) {
  return Number(hour) * 60 + Number(minute);
}

function normalizeLinkedDateTimeTriple(text) {
  const triple = /(?<!\d)(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)/g;
  return String(text || '').replace(triple, (whole, firstA, firstB, secondA, secondB, thirdA, thirdB) => {
    const firstIsDate = validDateParts(firstA, firstB);
    const thirdIsDate = validDateParts(thirdA, thirdB);
    const firstIsTime = validClockParts(firstA, firstB);
    const secondIsTime = validClockParts(secondA, secondB);
    const thirdIsTime = validClockParts(thirdA, thirdB);

    const dateTimeTime = firstIsDate && secondIsTime && thirdIsTime
      && clockMinutes(secondA, secondB) < clockMinutes(thirdA, thirdB);
    const timeTimeDate = thirdIsDate && firstIsTime && secondIsTime
      && clockMinutes(firstA, firstB) < clockMinutes(secondA, secondB);

    // The whole three-part token is atomic: the interval belongs only to its date.
    // Canonicalize an unambiguous time-time-date form to date-time-time for the reviewed R parser.
    if (timeTimeDate && !dateTimeTime) {
      return `${thirdA}.${thirdB}-${firstA}.${firstB}-${secondA}.${secondB}`;
    }
    return whole;
  });
}

function moveExplicitDateAfterSubject(text) {
  let result = String(text || '');
  for (const subject of SUBJECT_PATTERNS) {
    const dateFirst = new RegExp(String.raw`(?<!\d)(${DATE})\s*[-–]{1,2}\s*(${TIME_BLOCK})\s+(${subject})`, 'gi');
    result = result.replace(dateFirst, '$2 $3 $1');

    const timeFirst = new RegExp(String.raw`(${TIME_BLOCK})\s*[-–]{1,2}\s*(${DATE})\s+(${subject})`, 'gi');
    result = result.replace(timeFirst, '$1 $3 $2');
  }
  return result;
}

function normalizeMedicineCourse3Workbook(workbook) {
  const normalized = cloneWorkbook(workbook);
  for (const sheet of normalized.sheets || []) {
    for (const cell of sheet.cells || []) {
      if (typeof cell.value !== 'string') continue;
      let text = normalizeAdjacentTimes(cell.value);
      text = normalizeLinkedDateTimeTriple(text);
      text = moveExplicitDateAfterSubject(text);
      cell.value = text;
    }
  }
  return normalized;
}

function confirmedPeriod(options) {
  const academicYear = String(options?.academicYear || '').replace('-', '/');
  return Number(options?.course) === 3
    && options?.program === 'medicine'
    && Number(options?.semester) === 2
    && /^(?:2025\/26|2025\/2026)$/.test(academicYear);
}

function matchesEvent(event, group, date, spec) {
  if (!event) return false;
  const [sourceRange, start, end] = spec;
  return event.group === group
    && event.sourceRange === sourceRange
    && event.start === `${date}T${start}:00+03:00`
    && event.end === `${date}T${end}:00+03:00`;
}

function isConfirmedOverlap(first, second) {
  return CONFIRMED_OVERLAPS_2025_26.some((rule) =>
    (matchesEvent(first, rule.group, rule.date, rule.a) && matchesEvent(second, rule.group, rule.date, rule.b))
    || (matchesEvent(first, rule.group, rule.date, rule.b) && matchesEvent(second, rule.group, rule.date, rule.a))
  );
}

function applyConfirmedOverlapRules(result, options) {
  if (!confirmedPeriod(options) || !(result?.qa?.remainingOverlaps || []).length) return result;
  const eventById = new Map(
    (result.schedules || []).flatMap((schedule) => schedule.events || []).map((event) => [event.id, event]),
  );
  const confirmedOverlaps = [];
  const remainingOverlaps = [];
  for (const overlap of result.qa.remainingOverlaps || []) {
    const first = eventById.get(overlap.event1);
    const second = eventById.get(overlap.event2);
    if (isConfirmedOverlap(first, second)) confirmedOverlaps.push(overlap);
    else remainingOverlaps.push(overlap);
  }
  const qa = {
    ...result.qa,
    confirmedOverlaps,
    remainingOverlaps,
  };
  const hasBlockingIssue = Boolean(
    (qa.uncovered || []).length
    || (qa.extraLessonFailures || []).length
    || (qa.normalizationFailures || []).length,
  );
  qa.status = hasBlockingIssue ? 'REVIEW_REQUIRED' : 'PASS';
  return { ...result, qa };
}

export function parseMedicineCourse3RWorkbookReviewed(workbook, options = {}) {
  const result = parseWeeklyRWorkbookReviewed(normalizeMedicineCourse3Workbook(workbook), options);
  return applyConfirmedOverlapRules(result, options);
}
