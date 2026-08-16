import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['понедельник', 1], ['вторник', 2], ['среда', 3], ['четверг', 4], ['пятница', 5], ['суббота', 6], ['воскресенье', 7],
]);
const MONTH_INDEX = new Map([
  ['январь', 1], ['февраль', 2], ['март', 3], ['апрель', 4], ['май', 5], ['июнь', 6],
  ['июль', 7], ['август', 8], ['сентябрь', 9], ['октябрь', 10], ['ноябрь', 11], ['декабрь', 12],
]);
const REVIEWED_SLOT_END = new Map([
  ['13:00', '14:35'],
  ['14:45', '16:20'],
]);

export const IZHGMU_MEDICINE4_LECTURE_SLOT_EVIDENCE = Object.freeze([
  Object.freeze({
    url: 'https://www.igma.ru/component/content/article/3990-informatsiya-dlya-obuchayushchikhsya-studentam?Itemid=108&catid=47',
    note: 'Official IzhGMU department page confirms the 4-course medicine lecture slot 13:00-14:35 and separate stream semantics.',
  }),
]);

function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function normalizeClock(value) {
  const match = norm(value).match(/^(\d{1,2})[.:](\d{2})$/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : null;
}
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function isoWeekday(iso) { const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; }
function requiredPeriod(period) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(norm(period?.start_date)) || !/^20\d{2}-\d{2}-\d{2}$/.test(norm(period?.end_date))) {
    throw new TypeError('medicine-4 cycle period with exact start/end dates is required');
  }
  return { start_date: norm(period.start_date), end_date: norm(period.end_date), week1_start_date: norm(period.week1_start_date || period.start_date) };
}
function lectureSheet(structure) {
  const candidates = (structure?.sheets || []).filter((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 3 && /^предмет$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => /лекций для студентов 4 курса\s+лечебного/i.test(norm(cell.value)))
  ));
  if (candidates.length !== 1) { const e = new Error(`IZH medicine-4 lecture sheet is not unique: ${candidates.length}`); e.code = 'IZH_L4_SHEET_NOT_UNIQUE'; throw e; }
  return candidates[0];
}
function headerRow(sheet) {
  const rows = sheet.cells.filter((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)));
  if (rows.length !== 1) { const e = new Error(`IZH medicine-4 lecture header row changed: ${rows.length}`); e.code = 'IZH_L4_HEADER_NOT_UNIQUE'; throw e; }
  return rows[0].row;
}
function monthColumns(sheet, row) {
  const result = new Map();
  const anchors = sheet.cells.filter((cell) => cell.row === row && MONTH_INDEX.has(norm(cell.value).toLowerCase()));
  for (const cell of anchors) {
    const month = MONTH_INDEX.get(norm(cell.value).toLowerCase());
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endCol = merge?.endCol ?? cell.col;
    for (let col = cell.col; col <= endCol; col += 1) result.set(col, month);
  }
  if (!result.size) { const e = new Error('IZH medicine-4 lecture month grid missing'); e.code = 'IZH_L4_MONTH_GRID_MISSING'; throw e; }
  return result;
}
function dayRows(sheet) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const weekday = DAY_INDEX.get(norm(cell.value).toLowerCase());
    if (!weekday) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endRow = merge?.endRow ?? cell.row;
    for (let row = cell.row; row <= endRow; row += 1) result.set(row, { weekday, label: norm(cell.value), ref: cell.ref });
  }
  return result;
}
function countColumn(sheet, row) { return sheet.cells.find((cell) => cell.row === row && /кол-?во\s+лекц/i.test(norm(cell.value)))?.col ?? null; }
function streamSuffix(value) {
  const match = norm(value).match(/\s([12])\s*п\.?\s*$/i);
  return match ? Number(match[1]) : null;
}
function stripStreamSuffix(value) { return norm(value).replace(/\s*[12]\s*п\.?\s*$/i, '').trim(); }
function marker(sheet, pattern, kind) {
  const matches = sheet.cells.filter((cell) => pattern.test(norm(cell.value)));
  if (matches.length !== 1) { const e = new Error(`IZH medicine-4 ${kind} marker count changed: ${matches.length}`); e.code = 'IZH_L4_PERIOD_MARKER_CHANGED'; throw e; }
  const text = norm(matches[0].value);
  const m = text.match(/(\d{1,2})\.(\d{2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);
  if (!m) { const e = new Error(`IZH medicine-4 ${kind} marker malformed`); e.code = 'IZH_L4_PERIOD_MARKER_INVALID'; throw e; }
  return { kind, startDate: isoDate(Number(m[3]), Number(m[2]), Number(m[1])), endDateInclusive: isoDate(Number(m[6]), Number(m[5]), Number(m[4])), reference: `${sheet.name}!${matches[0].ref}`, rawSource: text };
}

export function parseIzhgmuMedicine4LectureStructure(structure, { stream, period } = {}) {
  const expectedStream = Number(stream);
  if (![1, 2].includes(expectedStream)) throw new TypeError('medicine-4 lecture stream must be 1 or 2');
  const p = requiredPeriod(period);
  const sheet = lectureSheet(structure); const hrow = headerRow(sheet); const months = monthColumns(sheet, hrow); const days = dayRows(sheet); const countCol = countColumn(sheet, hrow);
  const maxRow = Math.max(...sheet.cells.map((cell) => cell.row)); const series = []; const reviewRequired = [];
  for (let row = hrow + 1; row <= maxRow; row += 1) {
    const disciplineCell = sheet.cells.find((cell) => cell.row === row && cell.col === 3); const disciplineRaw = norm(disciplineCell?.value);
    const timeCell = sheet.cells.find((cell) => cell.row === row && cell.col === 2); const startTime = normalizeClock(timeCell?.value);
    if (!disciplineRaw || !startTime) continue;
    const rowStream = streamSuffix(disciplineRaw);
    if (rowStream !== expectedStream) { const e = new Error(`IZH medicine-4 lecture row stream mismatch: expected ${expectedStream}, got ${rowStream ?? 'none'} at ${disciplineCell.ref}`); e.code = 'IZH_L4_STREAM_SUFFIX_MISMATCH'; throw e; }
    const day = days.get(row) || null; const endTime = REVIEWED_SLOT_END.get(startTime) ?? null;
    const locationCell = sheet.cells.find((cell) => cell.row === row && cell.col === 4); const weekCell = sheet.cells.find((cell) => cell.row === row && cell.col === 5);
    const dates = []; const dateRefs = [];
    for (const [col, month] of months) {
      const cell = sheet.cells.find((item) => item.row === row && item.col === col); const dayNumber = Number(cell?.value);
      if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) continue;
      const year = Number(p.start_date.slice(0, 4)) + (month < Number(p.start_date.slice(5, 7)) ? 1 : 0);
      const date = isoDate(year, month, dayNumber); dates.push(date); dateRefs.push(`${sheet.name}!${cell.ref}`);
    }
    const warnings = [];
    if (!day?.weekday) warnings.push('medicine4_lecture_weekday_missing');
    if (!endTime) warnings.push('medicine4_lecture_slot_unreviewed');
    if (!dates.length) warnings.push('medicine4_lecture_exact_dates_missing');
    for (const date of dates) {
      if (date < p.start_date || date > p.end_date) warnings.push('medicine4_lecture_date_outside_cycle_period');
      if (day?.weekday && isoWeekday(date) !== day.weekday) warnings.push('medicine4_lecture_date_weekday_mismatch');
    }
    const declaredCell = countCol ? sheet.cells.find((cell) => cell.row === row && cell.col === countCol) : null;
    const declaredCount = /^\d+$/.test(norm(declaredCell?.value)) ? Number(norm(declaredCell.value)) : null;
    const item = {
      sourceRole: 'lecture', sourceSheet: sheet.name, stream: expectedStream, audienceScope: 'stream', groups: [],
      discipline: stripStreamSuffix(disciplineRaw), disciplineRaw, weekday: day?.weekday ?? null, weekdayLabel: day?.label ?? null,
      startTime, endTime, location: norm(locationCell?.value) || null, dates: [...new Set(dates)], declaredCount,
      parityRaw: norm(weekCell?.value) || null, status: warnings.length ? 'needs_review' : 'ok', warning: warnings[0] || null, warnings: [...new Set(warnings)],
      ruleIds: ['IZH-L4-01', 'IZH-L4-02', 'IZH-L4-03', 'IZH-L4-04'],
      references: [
        { role: 'discipline', range: `${sheet.name}!${disciplineCell.ref}` },
        ...(timeCell ? [{ role: 'start_time', range: `${sheet.name}!${timeCell.ref}` }] : []),
        ...(locationCell ? [{ role: 'location', range: `${sheet.name}!${locationCell.ref}` }] : []),
        ...dateRefs.map((range) => ({ role: 'date', range })),
        ...(declaredCell ? [{ role: 'declared_count', range: `${sheet.name}!${declaredCell.ref}` }] : []),
      ],
      externalEvidence: endTime ? IZHGMU_MEDICINE4_LECTURE_SLOT_EVIDENCE : [],
      rawSource: [day?.label, timeCell?.value, disciplineRaw, locationCell?.value, weekCell?.value].map(norm).filter(Boolean).join(' | '),
    };
    series.push(item); if (warnings.length) reviewRequired.push(item);
  }
  const markers = [marker(sheet, /^пр\.?\s*аттестация/i, 'intermediate_attestation'), marker(sheet, /^практика/i, 'practice')];
  return {
    profile: 'IZH-LECTURE-MEDICINE4-STREAM', sourceSheet: sheet.name, stream: expectedStream, period: p, periodMarkers: markers, series,
    safeSeries: series.filter((item) => item.status === 'ok'), reviewRequired,
    blockers: [
      ...(reviewRequired.length ? [{ warning: 'medicine4_lecture_structural_review_required', occurrences: reviewRequired.length }] : []),
      { warning: 'stream_group_mapping_required', streams: [1, 2], sourceStream: expectedStream, occurrences: series.reduce((sum, item) => sum + item.dates.length, 0) },
    ],
    stats: { sourceRows: series.length, exactOccurrences: series.reduce((sum, item) => sum + item.dates.length, 0), safeOccurrences: series.filter((item) => item.status === 'ok').reduce((sum, item) => sum + item.dates.length, 0), structuralReviewCount: reviewRequired.length },
    publishable: false,
  };
}

export async function parseIzhgmuMedicine4LectureWorkbook(buffer, options = {}) {
  return parseIzhgmuMedicine4LectureStructure(await readIzhgmuXlsxStructure(buffer), options);
}
