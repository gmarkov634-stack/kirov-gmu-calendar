import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['понедельник', 1], ['вторник', 2], ['среда', 3], ['четверг', 4],
  ['пятница', 5], ['суббота', 6], ['воскресенье', 7],
]);

const MONTH_INDEX = new Map([
  ['январь', 1], ['февраль', 2], ['март', 3], ['апрель', 4], ['май', 5], ['июнь', 6],
  ['июль', 7], ['август', 8], ['сентябрь', 9], ['октябрь', 10], ['ноябрь', 11], ['декабрь', 12],
]);

const REVIEWED_SLOT_END = new Map([
  ['13:00', '14:35'],
  ['14:45', '16:20'],
]);

export const IZHGMU_MEDICINE5_LECTURE_SLOT_EVIDENCE = Object.freeze([
  Object.freeze({
    url: 'https://www.igma.ru/component/content/article/4026-informatsiya-dlya-obuchayushchikhsya-studentam?Itemid=108&catid=51',
    note: 'Official IzhGMU department schedule explicitly uses 13:00-14:35 and 14:45-16:20 lecture slots.',
  }),
  Object.freeze({
    url: 'https://www.igma.ru/component/content/article/2772-01-department-of-philosophy-and-humanities?Itemid=108&catid=197',
    note: 'Official IzhGMU timetable explicitly confirms the 13:00-14:35 lecture slot.',
  }),
]);

const CORE_DISCIPLINES = Object.freeze([
  [/^поликлиническая\s+терапия/i, 'Поликлиническая терапия'],
  [/^избр\.?\s*вопр\.?\s*терапии/i, 'Избр. вопр. терапии'],
  [/^инфекцион\.?\s*бол\.?/i, 'Инфекционные болезни'],
  [/^мед-?прав\.?\s*основы/i, 'Мед-прав. основы'],
  [/^акушерство/i, 'Акушерство'],
  [/^травматология/i, 'Травматология'],
  [/^госпитальная\s+терапия/i, 'Госпитальная терапия'],
  [/^госпитальная\s+хирургия/i, 'Госпитальная хирургия'],
]);

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoWeekday(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysBetween(left, right) {
  return Math.floor((new Date(`${right}T00:00:00Z`) - new Date(`${left}T00:00:00Z`)) / 86_400_000);
}

function streamFromSheetName(name) {
  const match = norm(name).match(/(?:^|\s)([12])\s*п(?![A-Za-zА-Яа-яЁё0-9])/i);
  return match ? Number(match[1]) : null;
}

function lectureSheet(structure, expectedStream = null) {
  const candidates = (structure?.sheets || []).filter((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 3 && /^предмет$/i.test(norm(cell.value)))
  ));
  const filtered = expectedStream == null
    ? candidates
    : candidates.filter((sheet) => streamFromSheetName(sheet.name) === Number(expectedStream));
  if (filtered.length !== 1) {
    const error = new Error(`IZH medicine-5 lecture sheet is not unique for stream ${expectedStream ?? 'unknown'}: ${filtered.length}`);
    error.code = 'IZH_L5_SHEET_NOT_UNIQUE';
    throw error;
  }
  return filtered[0];
}

function headerRow(sheet) {
  const rows = sheet.cells.filter((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)));
  if (rows.length !== 1) {
    const error = new Error(`IZH medicine-5 lecture header row is not unique: ${rows.length}`);
    error.code = 'IZH_L5_HEADER_NOT_UNIQUE';
    throw error;
  }
  return rows[0].row;
}

function parsePeriod(sheet) {
  const monthNames = new Map([
    ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
    ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
  ]);
  for (const cell of sheet.cells) {
    const text = norm(cell.value);
    if (!/начало .*семестра/i.test(text) || !/окончание/i.test(text)) continue;
    const match = text.match(/начало .*семестра\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\s*г?\.?\s*,?\s*окончание\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})/i);
    if (!match) continue;
    const startMonth = monthNames.get(match[2].toLowerCase());
    const endMonth = monthNames.get(match[5].toLowerCase());
    if (!startMonth || !endMonth) continue;
    return {
      start_date: isoDate(Number(match[3]), startMonth, Number(match[1])),
      end_date: isoDate(Number(match[6]), endMonth, Number(match[4])),
      week1_start_date: isoDate(Number(match[3]), startMonth, Number(match[1])),
      reference: `${sheet.name}!${cell.ref}`,
    };
  }
  const error = new Error('IZH medicine-5 lecture semester period missing');
  error.code = 'IZH_L5_PERIOD_MISSING';
  throw error;
}

function monthColumns(sheet, row) {
  const result = new Map();
  const monthAnchors = sheet.cells
    .filter((cell) => cell.row === row && MONTH_INDEX.has(norm(cell.value).toLowerCase()))
    .sort((left, right) => left.col - right.col);
  for (const cell of monthAnchors) {
    const month = MONTH_INDEX.get(norm(cell.value).toLowerCase());
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endCol = merge?.endCol ?? cell.col;
    for (let col = cell.col; col <= endCol; col += 1) result.set(col, month);
  }
  if (!result.size) {
    const error = new Error('IZH medicine-5 lecture month grid missing');
    error.code = 'IZH_L5_MONTH_GRID_MISSING';
    throw error;
  }
  return result;
}

function countColumn(sheet, row) {
  return sheet.cells.find((cell) => cell.row === row && /кол-?во\s+лекц/i.test(norm(cell.value)))?.col ?? null;
}

function dayRows(sheet) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const weekday = DAY_INDEX.get(norm(cell.value).toLowerCase());
    if (!weekday) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endRow = merge?.endRow ?? cell.row;
    for (let row = cell.row; row <= endRow; row += 1) {
      result.set(row, { weekday, label: norm(cell.value), ref: cell.ref });
    }
  }
  return result;
}

function parityLabel(value) {
  const text = norm(value).toLowerCase();
  if (text.startsWith('над черт')) return 'above_line';
  if (text.startsWith('под черт')) return 'below_line';
  return null;
}

function expectedParity(date, period) {
  const weekIndex = Math.floor(daysBetween(period.week1_start_date, date) / 7) + 1;
  return weekIndex % 2 === 1 ? 'above_line' : 'below_line';
}

function stripStreamSuffix(value) {
  return norm(value)
    .replace(/\s+[12]\s*п\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCoreDiscipline(value) {
  const source = stripStreamSuffix(value);
  for (const [pattern, normalized] of CORE_DISCIPLINES) {
    if (pattern.test(source)) return normalized;
  }
  return null;
}

function isElective(value) {
  return /^ДВ\s*4\b/i.test(norm(value));
}

function markReview(item, warning) {
  item.status = 'needs_review';
  if (!item.warnings.includes(warning)) item.warnings.push(warning);
  item.warning ??= warning;
}

function optionList(sheet) {
  const marker = sheet.cells.find((cell) => cell.col === 2 && /^ДВ\s*4\s*$/i.test(norm(cell.value)));
  if (!marker) return [];
  const maxRow = Math.max(...sheet.cells.map((cell) => cell.row));
  const options = [];
  for (let row = marker.row + 1; row <= maxRow; row += 1) {
    const discipline = norm(sheet.cells.find((cell) => cell.row === row && cell.col === 3)?.value);
    const countRaw = norm(sheet.cells.find((cell) => cell.row === row && cell.col === 5)?.value);
    if (!discipline) continue;
    const studentCount = /^\d+$/.test(countRaw) ? Number(countRaw) : null;
    options.push({
      discipline,
      studentCount,
      reference: `${sheet.name}!C${row}`,
      countReference: studentCount == null ? null : `${sheet.name}!E${row}`,
    });
  }
  return options;
}

export function parseIzhgmuMedicine5LectureStructure(structure, { expectedStream = null } = {}) {
  const sheet = lectureSheet(structure, expectedStream);
  const stream = streamFromSheetName(sheet.name);
  if (![1, 2].includes(stream)) {
    const error = new Error(`IZH medicine-5 lecture stream missing from sheet name: ${sheet.name}`);
    error.code = 'IZH_L5_STREAM_MISSING';
    throw error;
  }
  if (expectedStream != null && stream !== Number(expectedStream)) {
    const error = new Error(`IZH medicine-5 lecture stream mismatch: ${stream}/${expectedStream}`);
    error.code = 'IZH_L5_STREAM_MISMATCH';
    throw error;
  }

  const hrow = headerRow(sheet);
  const period = parsePeriod(sheet);
  const months = monthColumns(sheet, hrow);
  const countCol = countColumn(sheet, hrow);
  const days = dayRows(sheet);
  const maxRow = Math.max(...sheet.cells.map((cell) => cell.row));
  const options = optionList(sheet);
  const series = [];
  const reviewRequired = [];

  for (let row = hrow + 1; row <= maxRow; row += 1) {
    const disciplineCell = sheet.cells.find((cell) => cell.row === row && cell.col === 3);
    const disciplineRaw = norm(disciplineCell?.value);
    const timeCell = sheet.cells.find((cell) => cell.row === row && cell.col === 2);
    const startTime = normalizeClock(timeCell?.value);
    if (!disciplineRaw || !startTime) continue;

    const locationCell = sheet.cells.find((cell) => cell.row === row && cell.col === 4);
    const parityCell = sheet.cells.find((cell) => cell.row === row && cell.col === 5);
    const day = days.get(row) || null;
    const parity = parityLabel(parityCell?.value);
    const choiceRequired = isElective(disciplineRaw);
    const coreDiscipline = choiceRequired ? null : normalizeCoreDiscipline(disciplineRaw);
    const endTime = REVIEWED_SLOT_END.get(startTime) ?? null;
    const dates = [];
    const dateReferences = [];
    for (const [col, month] of months) {
      const dateCell = sheet.cells.find((cell) => cell.row === row && cell.col === col);
      const dayNumber = Number(dateCell?.value);
      if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) continue;
      const date = isoDate(Number(period.start_date.slice(0, 4)), month, dayNumber);
      dates.push(date);
      dateReferences.push(`${sheet.name}!${dateCell.ref}`);
    }
    const declaredCell = countCol ? sheet.cells.find((cell) => cell.row === row && cell.col === countCol) : null;
    const declaredRaw = declaredCell?.value ?? null;
    const declaredCount = /^\d+$/.test(norm(declaredRaw)) ? Number(norm(declaredRaw)) : null;

    const item = {
      sourceRole: 'lecture',
      sourceSheet: sheet.name,
      stream,
      group: null,
      groups: [],
      discipline: coreDiscipline ?? disciplineRaw,
      disciplineRaw,
      weekday: day?.weekday ?? null,
      weekdayLabel: day?.label ?? null,
      startTime,
      endTime,
      location: norm(locationCell?.value) || null,
      parity,
      dates: [...new Set(dates)],
      declaredCount,
      declaredCountSemantics: 'source_metadata_only',
      choiceRequired,
      status: choiceRequired ? 'deferred' : 'ok',
      warning: choiceRequired ? 'elective_choice_required' : null,
      warnings: choiceRequired ? ['elective_choice_required'] : [],
      ruleIds: ['IZH-L5-01', 'IZH-L5-02', 'IZH-L5-03', 'IZH-L5-04', 'IZH-L5-05', 'IZH-L5-06'],
      references: [
        { role: 'discipline', range: `${sheet.name}!${disciplineCell.ref}` },
        ...(timeCell ? [{ role: 'start_time', range: `${sheet.name}!${timeCell.ref}` }] : []),
        ...(locationCell ? [{ role: 'location', range: `${sheet.name}!${locationCell.ref}` }] : []),
        ...(parityCell ? [{ role: 'week_label', range: `${sheet.name}!${parityCell.ref}` }] : []),
        ...dateReferences.map((range) => ({ role: 'date', range })),
        ...(declaredCell ? [{ role: 'declared_count', range: `${sheet.name}!${declaredCell.ref}` }] : []),
      ],
      externalEvidence: endTime ? IZHGMU_MEDICINE5_LECTURE_SLOT_EVIDENCE : [],
      rawSource: [day?.label, timeCell?.value, disciplineCell.value, locationCell?.value, parityCell?.value]
        .map(norm).filter(Boolean).join(' | '),
    };

    if (!choiceRequired && !coreDiscipline) markReview(item, 'medicine5_lecture_discipline_unknown');
    if (!day?.weekday) markReview(item, 'medicine5_lecture_weekday_missing');
    if (!endTime) markReview(item, 'medicine5_lecture_slot_unreviewed');
    if (!choiceRequired && item.dates.length === 0) markReview(item, 'medicine5_lecture_exact_dates_missing');

    for (const date of item.dates) {
      if (date < period.start_date || date > period.end_date) markReview(item, 'medicine5_lecture_date_outside_semester');
      if (day?.weekday && isoWeekday(date) !== day.weekday) markReview(item, 'medicine5_lecture_date_weekday_mismatch');
      if (parity && expectedParity(date, period) !== parity) markReview(item, 'medicine5_lecture_parity_date_mismatch');
    }

    if (choiceRequired) item.ruleIds.push('IZH-L5-07');
    series.push(item);
    if (item.status === 'needs_review') reviewRequired.push(item);
  }

  const coreSeries = series.filter((item) => !item.choiceRequired);
  const safeCoreSeries = coreSeries.filter((item) => item.status === 'ok');
  const electiveSeries = series.filter((item) => item.choiceRequired);
  const choiceRequired = electiveSeries.length || options.length ? {
    warning: 'elective_choice_required',
    stream,
    series: electiveSeries,
    options,
    ruleIds: ['IZH-L5-07'],
  } : null;
  const groupMappingRequired = {
    warning: 'stream_group_mapping_required',
    stream,
    ruleIds: ['IZH-L5-08'],
    note: 'The official lecture workbook identifies only the stream; it contains no group-to-stream mapping.',
  };

  return {
    profile: 'IZH-LECTURE-MEDICINE5',
    sourceSheet: sheet.name,
    stream,
    period,
    series,
    coreSeries,
    safeCoreSeries,
    electiveSeries,
    electiveOptions: options,
    reviewRequired,
    choiceRequired,
    groupMappingRequired,
    stats: {
      sourceRows: series.length,
      coreSeries: coreSeries.length,
      coreOccurrences: safeCoreSeries.reduce((count, item) => count + item.dates.length, 0),
      electiveSeries: electiveSeries.length,
      electiveOccurrences: electiveSeries.reduce((count, item) => count + item.dates.length, 0),
      electiveOptionCount: options.length,
      structuralReviewCount: reviewRequired.length,
    },
    sourceLevelReady: reviewRequired.length === 0,
    publishable: false,
  };
}

export async function parseIzhgmuMedicine5LectureWorkbook(buffer, options = {}) {
  return parseIzhgmuMedicine5LectureStructure(await readIzhgmuXlsxStructure(buffer), options);
}
