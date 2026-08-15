import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['понедельник', 1], ['вторник', 2], ['среда', 3], ['четверг', 4],
  ['пятница', 5], ['суббота', 6], ['воскресенье', 7],
]);
const MONTH_INDEX = new Map([
  ['январь', 1], ['февраль', 2], ['март', 3], ['апрель', 4], ['май', 5], ['июнь', 6],
  ['июль', 7], ['август', 8], ['сентябрь', 9], ['октябрь', 10], ['ноябрь', 11], ['декабрь', 12],
]);
const MONTH_GENITIVE = new Map([
  ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
  ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
]);
const REVIEWED_SLOT_END = new Map([
  ['13:00', '14:35'],
  ['14:45', '16:20'],
]);
const EXPECTED_GROUPS = Object.freeze(Array.from({ length: 30 }, (_, index) => String(601 + index)));

export const IZHGMU_MEDICINE6_LECTURE_SLOT_EVIDENCE = Object.freeze([
  Object.freeze({
    url: 'https://www.igma.ru/component/content/article/4026-informatsiya-dlya-obuchayushchikhsya-studentam?Itemid=108&catid=51',
    note: 'Official IzhGMU timetable evidence explicitly supports the reviewed 13:00-14:35 and 14:45-16:20 lecture slots.',
  }),
  Object.freeze({
    url: 'https://www.igma.ru/component/content/category/49-vnutrennikh-boleznej',
    note: 'Official IzhGMU department timetable explicitly states the 13:00-14:35 lecture slot for 6-course medicine.',
  }),
  Object.freeze({
    url: 'https://www.igma.ru/component/content/article/4087-informatsiya-dlya-obuchayushchikhsya-studentam',
    note: 'Official IzhGMU department timetable independently confirms the 14:45 start for 6-course emergency-care lectures.',
  }),
]);

const CORE_DISCIPLINES = Object.freeze([
  [/^онкология$/i, 'Онкология'],
  [/^основы экстренной и неотложной помощи$/i, 'Основы экстренной и неотложной помощи'],
  [/^фтизиатрия$/i, 'Фтизиатрия'],
  [/^коммуникативные навыки(?:\s+[12]\s*п\.?)?$/i, 'Коммуникативные навыки'],
  [/^основы современной хирургии$/i, 'Основы современной хирургии'],
  [/^поликл\.?\s*терапия$/i, 'Поликлиническая терапия'],
  [/^эпидемиология$/i, 'Эпидемиология'],
  [/^избр\.?\s*вопр\.?\s*терапии$/i, 'Избр. вопр. терапии'],
  [/^госпитальн[а-яё]*\s+терапия$/i, 'Госпитальная терапия'],
  [/^функциональная диагностика в клинике вн\.?\s*болезней$/i, 'Функциональная диагностика в клинике внутренних болезней'],
]);

function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : null;
}
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function isoWeekday(iso) { const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; }
function addDays(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
function lectureSheet(structure) {
  const candidates = (structure?.sheets || []).filter((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 3 && /^предмет$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => /лекций для студентов 6 курса лечебного/i.test(norm(cell.value)))
  ));
  if (candidates.length !== 1) {
    const error = new Error(`IZH medicine-6 lecture sheet is not unique: ${candidates.length}`);
    error.code = 'IZH_L6_SHEET_NOT_UNIQUE'; throw error;
  }
  return candidates[0];
}
function headerRow(sheet) {
  const rows = sheet.cells.filter((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)));
  if (rows.length !== 1) { const error = new Error(`IZH medicine-6 lecture header row changed: ${rows.length}`); error.code = 'IZH_L6_HEADER_NOT_UNIQUE'; throw error; }
  return rows[0].row;
}
function parsePeriod(sheet) {
  for (const cell of sheet.cells) {
    const text = norm(cell.value);
    if (!/начало .*семестра/i.test(text) || !/окончание/i.test(text)) continue;
    const match = text.match(/начало .*семестра\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\s*г?\.?\s*,?\s*окончание\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})/i);
    if (!match) continue;
    const sm = MONTH_GENITIVE.get(match[2].toLowerCase()); const em = MONTH_GENITIVE.get(match[5].toLowerCase());
    if (!sm || !em) continue;
    return { start_date: isoDate(Number(match[3]), sm, Number(match[1])), end_date: isoDate(Number(match[6]), em, Number(match[4])), week1_start_date: isoDate(Number(match[3]), sm, Number(match[1])), reference: `${sheet.name}!${cell.ref}` };
  }
  const error = new Error('IZH medicine-6 lecture semester period missing'); error.code = 'IZH_L6_PERIOD_MISSING'; throw error;
}
function parseRangeMarker(sheet, pattern, kind, title) {
  const matches = sheet.cells.filter((cell) => pattern.test(norm(cell.value)));
  if (matches.length !== 1) { const error = new Error(`IZH medicine-6 ${kind} marker count changed: ${matches.length}`); error.code = 'IZH_L6_PERIOD_MARKER_CHANGED'; throw error; }
  const cell = matches[0]; const text = norm(cell.value);
  const match = text.match(/(\d{1,2})\.(\d{2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);
  if (!match) { const error = new Error(`IZH medicine-6 ${kind} date range malformed: ${text}`); error.code = 'IZH_L6_PERIOD_MARKER_RANGE_INVALID'; throw error; }
  const startDate = isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  const endDateInclusive = isoDate(Number(match[6]), Number(match[5]), Number(match[4]));
  if (endDateInclusive < startDate) { const error = new Error(`IZH medicine-6 ${kind} range inverted`); error.code = 'IZH_L6_PERIOD_MARKER_RANGE_INVALID'; throw error; }
  return { kind, title, startDate, endDateInclusive, endDateExclusive: addDays(endDateInclusive, 1), timeBasis: 'date_range_only', suggestedAllDay: true, status: 'ok', warning: null, ruleIds: ['IZH-L6-09'], reference: `${sheet.name}!${cell.ref}`, rawSource: text };
}
function periodMarkers(sheet, period) {
  const preliminary = parseRangeMarker(sheet, /^пр\.?\s*аттестация(?![A-Za-zА-Яа-яЁё0-9])/i, 'preliminary_attestation', 'Предварительная аттестация');
  const gia = parseRangeMarker(sheet, /^гиа(?![A-Za-zА-Яа-яЁё0-9])/i, 'gia', 'ГИА');
  if (preliminary.startDate <= period.end_date) { const error = new Error('IZH medicine-6 preliminary attestation overlaps lecture semester'); error.code = 'IZH_L6_PERIOD_MARKER_OVERLAP'; throw error; }
  if (gia.startDate <= preliminary.endDateInclusive) { const error = new Error('IZH medicine-6 GIA overlaps preliminary attestation'); error.code = 'IZH_L6_PERIOD_MARKER_OVERLAP'; throw error; }
  return [preliminary, gia];
}
function monthColumns(sheet, row) {
  const result = new Map();
  const anchors = sheet.cells.filter((cell) => cell.row === row && MONTH_INDEX.has(norm(cell.value).toLowerCase())).sort((a, b) => a.col - b.col);
  for (const cell of anchors) {
    const month = MONTH_INDEX.get(norm(cell.value).toLowerCase()); const merge = sheet.merges.find((item) => item.startRef === cell.ref); const endCol = merge?.endCol ?? cell.col;
    for (let col = cell.col; col <= endCol; col += 1) result.set(col, month);
  }
  if (!result.size) { const error = new Error('IZH medicine-6 lecture month grid missing'); error.code = 'IZH_L6_MONTH_GRID_MISSING'; throw error; }
  return result;
}
function countColumn(sheet, row) { return sheet.cells.find((cell) => cell.row === row && /кол-?во\s+лекц/i.test(norm(cell.value)))?.col ?? null; }
function dayRows(sheet) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const weekday = DAY_INDEX.get(norm(cell.value).toLowerCase()); if (!weekday) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref); const endRow = merge?.endRow ?? cell.row;
    for (let row = cell.row; row <= endRow; row += 1) result.set(row, { weekday, label: norm(cell.value), ref: cell.ref });
  }
  return result;
}
function streamFromDiscipline(value) {
  const match = norm(value).match(/\s([12])\s*п\.?\s*$/i); return match ? Number(match[1]) : null;
}
function stripStreamSuffix(value) { return norm(value).replace(/\s+[12]\s*п\.?\s*$/i, '').trim(); }
function normalizeCoreDiscipline(value) {
  const source = stripStreamSuffix(value); for (const [pattern, normalized] of CORE_DISCIPLINES) if (pattern.test(source)) return normalized; return null;
}
function electiveSlot(value) {
  const match = norm(value).match(/^ДВ\s*[-–]?\s*([45])\b/i); return match ? Number(match[1]) : null;
}
function sourceCourseCount(sheet) {
  const values = sheet.cells.map((cell) => norm(cell.value)).filter(Boolean);
  const match = values.map((value) => value.match(/^(\d+)\s*чел\.?$/i)).find(Boolean);
  return match ? Number(match[1]) : null;
}
function electiveRoster(sheet, countCol) {
  if (!countCol) return [];
  const labelCol = countCol + 1; const studentCol = countCol + 2; const rows = [];
  for (const cell of sheet.cells.filter((item) => item.col === labelCol)) {
    const slot = electiveSlot(cell.value); if (!slot) continue;
    const countCell = sheet.cells.find((item) => item.row === cell.row && item.col === studentCol); const studentCount = /^\d+$/.test(norm(countCell?.value)) ? Number(norm(countCell.value)) : null;
    rows.push({ slot, labelRaw: norm(cell.value), studentCount, reference: `${sheet.name}!${cell.ref}`, countReference: countCell ? `${sheet.name}!${countCell.ref}` : null });
  }
  return rows;
}
function assertCourseGroups(groups) {
  if (groups == null) return [];
  const normalized = [...new Set(groups.map((value) => String(value)))].sort((a, b) => Number(a) - Number(b));
  if (normalized.join('|') !== EXPECTED_GROUPS.join('|')) { const error = new Error(`IZH medicine-6 lecture course group set changed: ${normalized.join(', ')}`); error.code = 'IZH_L6_GROUP_SET_CHANGED'; throw error; }
  return normalized;
}
function markReview(item, warning) { item.status = 'needs_review'; if (!item.warnings.includes(warning)) item.warnings.push(warning); item.warning ??= warning; }
function reconcileDeclaredCounts(series) {
  const byDiscipline = new Map();
  for (const item of series.filter((entry) => !entry.choiceRequired)) {
    const key = `${item.discipline}|${item.stream ?? 'course'}`; if (!byDiscipline.has(key)) byDiscipline.set(key, []); byDiscipline.get(key).push(item);
  }
  for (const items of byDiscipline.values()) {
    const declared = items.filter((item) => Number.isInteger(item.declaredCount));
    if (!declared.length) continue;
    if (items.length === 1) {
      const item = items[0]; item.declaredCountScope = 'row'; if (item.declaredCount !== item.dates.length) markReview(item, 'medicine6_lecture_declared_count_mismatch'); continue;
    }
    if (declared.length === 1) {
      const total = items.reduce((sum, item) => sum + item.dates.length, 0); const anchor = declared[0]; anchor.declaredCountScope = 'discipline_total';
      for (const item of items) item.declaredCountGroupReference = anchor.references.find((ref) => ref.role === 'declared_count')?.range ?? null;
      if (anchor.declaredCount !== total) for (const item of items) markReview(item, 'medicine6_lecture_declared_count_mismatch');
      continue;
    }
    for (const item of items) if (Number.isInteger(item.declaredCount)) { item.declaredCountScope = 'row'; if (item.declaredCount !== item.dates.length) markReview(item, 'medicine6_lecture_declared_count_mismatch'); }
  }
}

export function parseIzhgmuMedicine6LectureStructure(structure, { courseGroups = null } = {}) {
  const sheet = lectureSheet(structure); const hrow = headerRow(sheet); const period = parsePeriod(sheet); const markers = periodMarkers(sheet, period); const months = monthColumns(sheet, hrow); const countCol = countColumn(sheet, hrow); const days = dayRows(sheet); const groups = assertCourseGroups(courseGroups); const maxRow = Math.max(...sheet.cells.map((cell) => cell.row));
  const series = [];
  for (let row = hrow + 1; row <= maxRow; row += 1) {
    const disciplineCell = sheet.cells.find((cell) => cell.row === row && cell.col === 3); const disciplineRaw = norm(disciplineCell?.value); const timeCell = sheet.cells.find((cell) => cell.row === row && cell.col === 2); const startTime = normalizeClock(timeCell?.value);
    if (!disciplineRaw || !startTime) continue;
    const locationCell = sheet.cells.find((cell) => cell.row === row && cell.col === 4); const day = days.get(row) || null; const slot = electiveSlot(disciplineRaw); const stream = slot ? null : streamFromDiscipline(disciplineRaw); const core = slot ? null : normalizeCoreDiscipline(disciplineRaw); const endTime = REVIEWED_SLOT_END.get(startTime) ?? null;
    const dates = []; const dateReferences = [];
    for (const [col, month] of months) { const dateCell = sheet.cells.find((cell) => cell.row === row && cell.col === col); const dayNumber = Number(dateCell?.value); if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) continue; const date = isoDate(Number(period.start_date.slice(0, 4)), month, dayNumber); dates.push(date); dateReferences.push(`${sheet.name}!${dateCell.ref}`); }
    const declaredCell = countCol ? sheet.cells.find((cell) => cell.row === row && cell.col === countCol) : null; const declaredCount = /^\d+$/.test(norm(declaredCell?.value)) ? Number(norm(declaredCell.value)) : null; const choiceRequired = slot != null; const audienceScope = choiceRequired ? 'choice' : stream ? 'stream' : 'course';
    const item = {
      sourceRole: 'lecture', sourceSheet: sheet.name, discipline: core ?? disciplineRaw, disciplineRaw, weekday: day?.weekday ?? null, weekdayLabel: day?.label ?? null,
      startTime, endTime, location: norm(locationCell?.value) || null, dates: [...new Set(dates)], declaredCount, declaredCountScope: null,
      stream, electiveSlot: slot, audienceScope, groups: audienceScope === 'course' ? groups : [], choiceRequired,
      status: choiceRequired || stream ? 'deferred' : 'ok', warning: choiceRequired ? 'elective_choice_required' : stream ? 'stream_group_mapping_required' : null,
      warnings: choiceRequired ? ['elective_choice_required'] : stream ? ['stream_group_mapping_required'] : [],
      ruleIds: ['IZH-L6-01', 'IZH-L6-02', 'IZH-L6-03', 'IZH-L6-04', 'IZH-L6-05', 'IZH-L6-06'],
      references: [
        { role: 'discipline', range: `${sheet.name}!${disciplineCell.ref}` },
        ...(timeCell ? [{ role: 'start_time', range: `${sheet.name}!${timeCell.ref}` }] : []),
        ...(locationCell ? [{ role: 'location', range: `${sheet.name}!${locationCell.ref}` }] : []),
        ...dateReferences.map((range) => ({ role: 'date', range })),
        ...(declaredCell ? [{ role: 'declared_count', range: `${sheet.name}!${declaredCell.ref}` }] : []),
      ],
      externalEvidence: endTime ? IZHGMU_MEDICINE6_LECTURE_SLOT_EVIDENCE : [], rawSource: [day?.label, timeCell?.value, disciplineRaw, locationCell?.value].map(norm).filter(Boolean).join(' | '),
    };
    if (!choiceRequired && !core) markReview(item, 'medicine6_lecture_discipline_unknown');
    if (!day?.weekday) markReview(item, 'medicine6_lecture_weekday_missing');
    if (!endTime) markReview(item, 'medicine6_lecture_slot_unreviewed');
    if (!choiceRequired && item.dates.length === 0) markReview(item, 'medicine6_lecture_exact_dates_missing');
    for (const date of item.dates) { if (date < period.start_date || date > period.end_date) markReview(item, 'medicine6_lecture_date_outside_semester'); if (day?.weekday && isoWeekday(date) !== day.weekday) markReview(item, 'medicine6_lecture_date_weekday_mismatch'); }
    if (stream) item.ruleIds.push('IZH-L6-07'); if (choiceRequired) item.ruleIds.push('IZH-L6-08'); series.push(item);
  }
  reconcileDeclaredCounts(series);
  const electiveSeries = series.filter((item) => item.choiceRequired); const streamSeries = series.filter((item) => item.stream); const courseWideCoreSeries = series.filter((item) => !item.choiceRequired && !item.stream); const reviewRequired = series.filter((item) => item.status === 'needs_review');
  for (const item of electiveSeries) if (Number.isInteger(item.declaredCount) && item.declaredCount !== item.dates.length && !item.warnings.includes('elective_declared_count_mismatch')) item.warnings.push('elective_declared_count_mismatch');
  const roster = electiveRoster(sheet, countCol); const rosterTotals = Object.fromEntries([4, 5].map((slot) => [slot, roster.filter((item) => item.slot === slot).reduce((sum, item) => sum + (item.studentCount ?? 0), 0)])); const titleStudentCount = sourceCourseCount(sheet); const diagnostics = [];
  for (const slot of [4, 5]) if (roster.filter((item) => item.slot === slot).length === 0) diagnostics.push({ warning: 'elective_roster_missing', slot });
  if (titleStudentCount && ((rosterTotals[4] && rosterTotals[4] !== titleStudentCount) || (rosterTotals[5] && rosterTotals[5] !== titleStudentCount))) diagnostics.push({ warning: 'elective_roster_total_differs_from_title_count', titleStudentCount, rosterTotals });
  const blockers = [
    ...(streamSeries.length ? [{ warning: 'stream_group_mapping_required', streams: [...new Set(streamSeries.map((item) => item.stream))].sort(), occurrences: streamSeries.reduce((sum, item) => sum + item.dates.length, 0), ruleIds: ['IZH-L6-07'] }] : []),
    ...(electiveSeries.length ? [{ warning: 'elective_choice_required', slots: [...new Set(electiveSeries.map((item) => item.electiveSlot))].sort(), occurrences: electiveSeries.reduce((sum, item) => sum + item.dates.length, 0), ruleIds: ['IZH-L6-08'] }] : []),
  ];
  return {
    profile: 'IZH-LECTURE-MEDICINE6', sourceSheet: sheet.name, period, periodMarkers: markers, courseGroups: groups, series,
    courseWideCoreSeries, streamSeries, electiveSeries, electiveRoster: roster, diagnostics, reviewRequired, blockers,
    stats: {
      sourceRows: series.length,
      coreSeries: series.filter((item) => !item.choiceRequired).length,
      coreOccurrences: series.filter((item) => !item.choiceRequired).reduce((sum, item) => sum + item.dates.length, 0),
      courseWideCoreSeries: courseWideCoreSeries.length,
      courseWideCoreOccurrences: courseWideCoreSeries.filter((item) => item.status === 'ok').reduce((sum, item) => sum + item.dates.length, 0),
      streamSeries: streamSeries.length,
      streamOccurrences: streamSeries.reduce((sum, item) => sum + item.dates.length, 0),
      electiveSeries: electiveSeries.length,
      electiveOccurrences: electiveSeries.reduce((sum, item) => sum + item.dates.length, 0),
      electiveOptionCount: roster.length,
      electiveDeclaredCountMismatchRows: electiveSeries.filter((item) => item.warnings.includes('elective_declared_count_mismatch')).length,
      structuralReviewCount: reviewRequired.length,
      periodMarkerCount: markers.length,
      titleStudentCount,
      electiveRosterTotals: rosterTotals,
    },
    sourceLevelReady: reviewRequired.length === 0,
    courseWideGroupReady: reviewRequired.length === 0 && groups.length === EXPECTED_GROUPS.length,
    publishable: false,
  };
}

export async function parseIzhgmuMedicine6LectureWorkbook(buffer, options = {}) {
  return parseIzhgmuMedicine6LectureStructure(await readIzhgmuXlsxStructure(buffer), options);
}

export const IZHGMU_MEDICINE6_EXPECTED_GROUPS = EXPECTED_GROUPS;
