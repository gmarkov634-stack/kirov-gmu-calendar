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
  const adjacent = new RegExp(String.raw`(${TIME})\s+(${TIME})(?=\s+[А-ЯЁ])`, 'g');
  return String(text || '').replace(adjacent, '$1, $2');
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

export function parseMedicineCourse3RWorkbookReviewed(workbook, options = {}) {
  return parseWeeklyRWorkbookReviewed(normalizeMedicineCourse3Workbook(workbook), options);
}
