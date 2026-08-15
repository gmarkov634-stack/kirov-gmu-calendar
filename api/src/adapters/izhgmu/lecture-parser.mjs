import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['понедельник', 1],
  ['вторник', 2],
  ['среда', 3],
  ['четверг', 4],
  ['пятница', 5],
  ['суббота', 6],
  ['воскресенье', 7],
]);

const MONTH_INDEX = new Map([
  ['январь', 1], ['февраль', 2], ['март', 3], ['апрель', 4], ['май', 5], ['июнь', 6],
  ['июль', 7], ['август', 8], ['сентябрь', 9], ['октябрь', 10], ['ноябрь', 11], ['декабрь', 12],
]);

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function columnLetters(value) {
  let n = Number(value);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{1,2})$/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}`;
}

function parseClockRange(value) {
  const match = String(value ?? '').match(/(\d{1,2}[.:]\d{1,2})\s*[-–]\s*(\d{1,2}[.:]\d{1,2})/);
  if (!match) return null;
  return { start: normalizeClock(match[1]), end: normalizeClock(match[2]) };
}

function dateObj(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function isoWeekday(iso) {
  const day = dateObj(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysBetween(left, right) {
  return Math.floor((dateObj(right) - dateObj(left)) / 86_400_000);
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayRows(sheet) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const label = norm(cell.value).toLowerCase();
    const weekday = DAY_INDEX.get(label);
    if (!weekday) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endRow = merge?.endRow ?? cell.row;
    for (let row = cell.row; row <= endRow; row += 1) {
      result.set(row, { weekday, label: norm(cell.value), ref: cell.ref });
    }
  }
  return result;
}

function groupHeaders(sheet) {
  const candidates = sheet.cells.filter((cell) => /^\d{3,4}$/.test(norm(cell.value)) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const selected = [...byRow.values()].sort((left, right) => right.length - left.length)[0];
  if (!selected || selected.length < 2) {
    const error = new Error('IZH-LECTURE class group span missing');
    error.code = 'IZH_LECTURE_GROUP_SPAN_MISSING';
    throw error;
  }
  const groups = selected.sort((left, right) => left.col - right.col);
  return { firstCol: groups[0].col, lastCol: groups.at(-1).col };
}

function classTimeSlots(sheet, classDays) {
  const slots = [];
  for (const cell of sheet.cells.filter((item) => item.col === 2)) {
    const range = parseClockRange(cell.value);
    if (!range?.start || !range?.end) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const startRow = cell.row;
    const endRow = merge?.endRow ?? cell.row;
    const weekdays = [...new Set(
      Array.from({ length: endRow - startRow + 1 }, (_, index) => classDays.get(startRow + index)?.weekday)
        .filter(Boolean),
    )];
    slots.push({
      startRow,
      endRow,
      startTime: range.start,
      endTime: range.end,
      weekday: weekdays.length === 1 ? weekdays[0] : null,
      dayEvidenceCount: weekdays.length,
      ref: cell.ref,
      merge: merge?.ref ?? cell.ref,
      raw: cell.value,
    });
  }
  return slots;
}

function isChoiceBlock(value) {
  const text = norm(value);
  const dvMarkers = text.match(/(?:^|[\s;,:()])ДВ(?=$|[\s;,:().])/gi) || [];
  return /^ДВ(?=$|[\s;,:().])/i.test(text)
    || /практические занятия по ДВ(?=$|[\s;,:().])/i.test(text)
    || dvMarkers.length >= 2
    || /дисциплин(?:а|ы) по выбору/i.test(text);
}

function classWideBlocks(sheet) {
  const { firstCol, lastCol } = groupHeaders(sheet);
  const classDays = dayRows(sheet);
  const slots = classTimeSlots(sheet, classDays);
  const blocks = [];

  for (const merge of sheet.merges) {
    if (merge.startCol > firstCol || merge.endCol < lastCol) continue;
    const anchor = sheet.cells.find((cell) => cell.row === merge.startRow && cell.col === merge.startCol);
    const value = anchor?.value ?? '';
    if (!norm(value)) continue;
    const slot = slots.find((item) => merge.startRow >= item.startRow && merge.startRow <= item.endRow) || null;
    const directDay = classDays.get(merge.startRow) || null;
    const weekday = directDay?.weekday ?? slot?.weekday ?? null;
    blocks.push({
      ref: anchor?.ref ?? merge.startRef,
      row: merge.startRow,
      merge: merge.ref,
      value,
      weekday,
      weekdayLabel: directDay?.label ?? null,
      dayReference: directDay?.ref ?? null,
      dayRecoveredFromTimeSlot: !directDay && Boolean(slot?.weekday),
      startTime: slot?.startTime ?? null,
      endTime: slot?.endTime ?? null,
      timeReference: slot?.ref ?? null,
      slotKey: weekday && slot?.startTime ? `${weekday}|${slot.startTime}` : null,
      choiceRequired: isChoiceBlock(value),
    });
  }

  return { blocks, slots };
}

function lectureSheet(structure) {
  return structure?.sheets?.find((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 3 && /^(предмет|дисциплина)$/i.test(norm(cell.value))
  ));
}

function headerRow(sheet) {
  const candidates = sheet.cells.filter((cell) => cell.col === 1 && /^дни недели$/i.test(norm(cell.value)));
  if (candidates.length !== 1) {
    const error = new Error('IZH-LECTURE header row is not unique');
    error.code = 'IZH_LECTURE_HEADER_MISSING';
    throw error;
  }
  return candidates[0].row;
}

function monthColumns(sheet, row) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.row === row)) {
    const month = MONTH_INDEX.get(norm(cell.value).toLowerCase());
    if (!month) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endCol = merge?.endCol ?? cell.col;
    for (let col = cell.col; col <= endCol; col += 1) result.set(col, month);
  }
  if (!result.size) {
    const error = new Error('IZH-LECTURE month grid missing');
    error.code = 'IZH_LECTURE_MONTH_GRID_MISSING';
    throw error;
  }
  return result;
}

function countColumn(sheet, row) {
  const cell = sheet.cells.find((item) => item.row === row && /кол-?во|количество/i.test(norm(item.value)));
  return cell?.col ?? null;
}

function parityLabel(value) {
  const text = norm(value).toLowerCase();
  if (text.startsWith('над черт')) return 'above_line';
  if (text.startsWith('под черт')) return 'below_line';
  if (/ежен/.test(text)) return 'weekly_declared';
  return null;
}

function expectedParity(date, period, weeklyParity) {
  const weekIndex = Math.floor(daysBetween(period.week1_start_date, date) / 7) + 1;
  return weekIndex % 2 === 1 ? weeklyParity.odd : weeklyParity.even;
}

function markReview(series, warning) {
  series.status = 'needs_review';
  if (!series.warnings.includes(warning)) series.warnings.push(warning);
  series.warning ??= warning;
}

function normalizeDisciplineKey(value) {
  return norm(value).toLowerCase().replace(/ё/g, 'е');
}

function validateDeclaredCounts(series) {
  const byDiscipline = new Map();
  for (const item of series) {
    const key = normalizeDisciplineKey(item.discipline);
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key).push(item);
  }

  for (const items of byDiscipline.values()) {
    const declared = items.filter((item) => Number.isInteger(item.declaredCount));
    if (!declared.length) continue;
    if (declared.length === 1) {
      const holder = declared[0];
      const expected = items.length === 1
        ? holder.dates.length
        : items.reduce((count, item) => count + item.dates.length, 0);
      holder.declaredCountScope = items.length === 1 ? 'row' : 'discipline_total';
      for (const item of items) item.ruleIds.push('IZH-L05');
      if (holder.declaredCount !== expected) {
        for (const item of items) markReview(item, 'declared_lecture_count_mismatch');
      }
      continue;
    }

    const rowWise = declared.every((item) => item.declaredCount === item.dates.length);
    for (const item of items) item.ruleIds.push('IZH-L05');
    if (!rowWise) {
      for (const item of items) markReview(item, 'declared_lecture_count_scope_ambiguous');
    }
  }
}

export function parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed }) {
  if (!weeklyParsed?.period || !weeklyParsed?.parity) {
    throw new TypeError('weeklyParsed with period/parity evidence is required');
  }
  const classSheet = classStructure?.sheets?.find((sheet) => sheet.name.toLowerCase().includes('расписание'));
  const lectures = lectureSheet(lectureStructure);
  if (!classSheet || !lectures) {
    const error = new Error('IZH-LECTURE required source sheets missing');
    error.code = 'IZH_LECTURE_REQUIRED_SHEET_MISSING';
    throw error;
  }

  const hrow = headerRow(lectures);
  const months = monthColumns(lectures, hrow);
  const days = dayRows(lectures);
  const countCol = countColumn(lectures, hrow);
  const classCoverage = classWideBlocks(classSheet);
  const period = weeklyParsed.period;
  const startYear = Number(period.start_date.slice(0, 4));
  const startMonth = Number(period.start_date.slice(5, 7));
  const maxRow = Math.max(...lectures.cells.map((cell) => cell.row));
  const series = [];

  for (let row = hrow + 1; row <= maxRow; row += 1) {
    const disciplineCell = lectures.cells.find((cell) => cell.row === row && cell.col === 3);
    if (!norm(disciplineCell?.value)) continue;
    const timeCell = lectures.cells.find((cell) => cell.row === row && cell.col === 2);
    const locationCell = lectures.cells.find((cell) => cell.row === row && cell.col === 4);
    const weekCell = lectures.cells.find((cell) => cell.row === row && cell.col === 5);
    const day = days.get(row) || null;
    const startTime = normalizeClock(timeCell?.value);
    const slotCandidates = classCoverage.slots.filter((slot) => slot.weekday === day?.weekday && slot.startTime === startTime);
    const slot = slotCandidates.length === 1 ? slotCandidates[0] : null;
    const slotKey = day?.weekday && startTime ? `${day.weekday}|${startTime}` : null;
    const relatedBlocks = classCoverage.blocks.filter((block) => block.slotKey === slotKey);
    const choiceRequired = relatedBlocks.some((block) => block.choiceRequired);
    const dates = [];
    const dateRefs = [];

    for (const [col, month] of months) {
      const dateCell = lectures.cells.find((cell) => cell.row === row && cell.col === col);
      const dayNumber = Number(dateCell?.value);
      if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) continue;
      let year = startYear;
      if (month < startMonth) year += 1;
      const date = isoDate(year, month, dayNumber);
      dates.push(date);
      dateRefs.push(`${lectures.name}!${dateCell.ref}`);
    }

    const declaredRaw = countCol
      ? lectures.cells.find((cell) => cell.row === row && cell.col === countCol)?.value
      : null;
    const declaredCount = /^\d+$/.test(norm(declaredRaw)) ? Number(norm(declaredRaw)) : null;
    const parity = parityLabel(weekCell?.value);
    const lessonType = /^физвоспит/i.test(norm(disciplineCell.value))
      ? { raw: 'физическая культура', code: 'physical_education' }
      : { raw: 'лекция', code: 'lecture' };

    const item = {
      sourceRole: 'lecture',
      sourceSheet: lectures.name,
      discipline: norm(disciplineCell.value),
      weekday: day?.weekday ?? null,
      weekdayLabel: day?.label ?? null,
      startTime,
      endTime: slot?.endTime ?? null,
      location: norm(locationCell?.value) || null,
      parity,
      dates: [...new Set(dates)],
      declaredCount,
      declaredCountScope: null,
      lessonType,
      slotKey,
      classTimeReference: slot?.ref ?? null,
      choiceRequired,
      status: choiceRequired ? 'deferred' : 'ok',
      warning: choiceRequired ? 'elective_choice_required' : null,
      warnings: choiceRequired ? ['elective_choice_required'] : [],
      ruleIds: ['IZH-L01', 'IZH-L02', 'IZH-L03', 'IZH-L06'],
      references: [
        { role: 'discipline', range: `${lectures.name}!${disciplineCell.ref}` },
        ...(timeCell ? [{ role: 'start_time', range: `${lectures.name}!${timeCell.ref}` }] : []),
        ...(locationCell ? [{ role: 'location', range: `${lectures.name}!${locationCell.ref}` }] : []),
        ...(weekCell ? [{ role: 'week_label', range: `${lectures.name}!${weekCell.ref}` }] : []),
        ...dateRefs.map((range) => ({ role: 'date', range })),
        ...(countCol && declaredRaw != null ? [{ role: 'declared_count', range: `${lectures.name}!${columnLetters(countCol)}${row}` }] : []),
        ...(slot ? [{ role: 'end_time', range: `${classSheet.name}!${slot.ref}` }] : []),
      ],
      rawSource: [day?.label, timeCell?.value, disciplineCell.value, locationCell?.value, weekCell?.value]
        .map(norm).filter(Boolean).join(' | '),
    };

    if (!day?.weekday) markReview(item, 'lecture_weekday_missing');
    if (!startTime) markReview(item, 'lecture_start_time_invalid');
    if (!slot) markReview(item, slotCandidates.length > 1 ? 'lecture_end_time_slot_ambiguous' : 'lecture_end_time_slot_missing');
    if (!item.dates.length) markReview(item, 'lecture_exact_dates_missing');

    for (const date of item.dates) {
      if (date < period.start_date || date > period.end_date) markReview(item, 'lecture_date_outside_semester');
      if (day?.weekday && isoWeekday(date) !== day.weekday) markReview(item, 'lecture_date_weekday_mismatch');
      if ((parity === 'above_line' || parity === 'below_line')
          && expectedParity(date, period, weeklyParsed.parity) !== parity) {
        markReview(item, 'lecture_parity_date_mismatch');
      }
    }
    if (parity === 'above_line' || parity === 'below_line') item.ruleIds.push('IZH-L04');
    if (choiceRequired) item.ruleIds.push('IZH-L07');
    series.push(item);
  }

  validateDeclaredCounts(series);

  const lectureSlotKeys = new Set(series.map((item) => item.slotKey).filter(Boolean));
  const blockCoverage = classCoverage.blocks.map((block) => {
    if (block.choiceRequired) return { ...block, coverage: 'choice_required' };
    if (block.slotKey && lectureSlotKeys.has(block.slotKey)) return { ...block, coverage: 'resolved_by_lecture' };
    return { ...block, coverage: 'unmapped' };
  });

  const safeSeries = series.filter((item) => item.status === 'ok' && !item.choiceRequired);
  const reviewRequired = series.filter((item) => item.status === 'needs_review');
  const electiveOptions = series.filter((item) => item.choiceRequired).map((item) => ({
    discipline: item.discipline,
    dates: item.dates,
    startTime: item.startTime,
    endTime: item.endTime,
    location: item.location,
    parity: item.parity,
    references: item.references,
  }));
  const choiceBlocks = blockCoverage.filter((item) => item.coverage === 'choice_required');
  const unmappedBlocks = blockCoverage.filter((item) => item.coverage === 'unmapped');
  if (unmappedBlocks.length) {
    reviewRequired.push(...unmappedBlocks.map((block) => ({
      discipline: norm(block.value),
      status: 'needs_review',
      warning: 'stream_wide_class_block_unmapped',
      warnings: ['stream_wide_class_block_unmapped'],
      ruleIds: ['IZH-L08'],
      references: [{ role: 'class_block', range: `${classSheet.name}!${block.ref}` }],
      rawSource: block.value,
    })));
  }

  const choiceRequired = choiceBlocks.length ? {
    warning: 'elective_choice_required',
    blocks: choiceBlocks,
    options: electiveOptions,
    ruleIds: ['IZH-L07'],
  } : null;

  return {
    profile: 'IZH-LECTURE',
    sourceSheet: lectures.name,
    period,
    series,
    safeSeries,
    reviewRequired,
    choiceRequired,
    classCoverage: {
      totalWideBlocks: blockCoverage.length,
      resolvedByLecture: blockCoverage.filter((item) => item.coverage === 'resolved_by_lecture'),
      choiceRequired: choiceBlocks,
      unmapped: unmappedBlocks,
      blocks: blockCoverage,
    },
    stats: {
      lectureRows: series.length,
      exactOccurrences: series.reduce((count, item) => count + item.dates.length, 0),
      safeOccurrences: safeSeries.reduce((count, item) => count + item.dates.length, 0),
      electiveOccurrences: electiveOptions.reduce((count, item) => count + item.dates.length, 0),
    },
    publishable: reviewRequired.length === 0 && !choiceRequired,
  };
}

export async function parseIzhgmuLecturePair({ classBuffer, lectureBuffer, weeklyParsed }) {
  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  return parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed });
}
