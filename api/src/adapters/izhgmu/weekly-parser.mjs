import fs from 'node:fs/promises';
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
  ['январь', 1],
  ['февраль', 2],
  ['март', 3],
  ['апрель', 4],
  ['май', 5],
  ['июнь', 6],
  ['июль', 7],
  ['август', 8],
  ['сентябрь', 9],
  ['октябрь', 10],
  ['ноябрь', 11],
  ['декабрь', 12],
]);

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseRuDate(raw) {
  const match = String(raw || '').match(/(\d{1,2})[.](\d{1,2})[.](\d{2,4})/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return isoDate(year, Number(match[2]), Number(match[1]));
}

function dateObj(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso, days) {
  const date = dateObj(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  return Math.floor((dateObj(right) - dateObj(left)) / 86_400_000);
}

function isoWeekday(iso) {
  const day = dateObj(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

function parsePeriod(companionSheet) {
  for (const cell of companionSheet.cells) {
    const text = norm(cell.value);
    if (!/семестр/i.test(text)) continue;
    const dates = [...text.matchAll(/\d{1,2}[.]\d{1,2}[.]\d{2,4}/g)]
      .map((match) => parseRuDate(match[0]))
      .filter(Boolean);
    if (dates.length >= 2) {
      return {
        start_date: dates[0],
        end_date: dates[1],
        week1_start_date: dates[0],
        reference: `${companionSheet.name}!${cell.ref}`,
      };
    }
  }
  const error = new Error('IZH-WEEKLY companion semester period missing');
  error.code = 'IZH_PERIOD_MISSING';
  throw error;
}

function monthByColumn(sheet) {
  const result = new Map();
  for (const cell of sheet.cells.filter((item) => item.row === 6)) {
    const month = MONTH_INDEX.get(norm(cell.value).toLowerCase());
    if (!month) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const endColumn = merge?.endCol ?? cell.col;
    for (let column = cell.col; column <= endColumn; column += 1) result.set(column, month);
  }
  return result;
}

function inferParity(companionSheet, period) {
  const months = monthByColumn(companionSheet);
  const observations = [];
  const startYear = Number(period.start_date.slice(0, 4));
  const startMonth = Number(period.start_date.slice(5, 7));

  for (const parityCell of companionSheet.cells.filter((item) => item.col === 5)) {
    const label = norm(parityCell.value).toLowerCase();
    const parity = label.startsWith('над черт')
      ? 'above_line'
      : label.startsWith('под черт')
        ? 'below_line'
        : null;
    if (!parity) continue;

    for (const dateCell of companionSheet.cells.filter(
      (item) => item.row === parityCell.row && months.has(item.col),
    )) {
      const day = Number(dateCell.value);
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const month = months.get(dateCell.col);
      let year = startYear;
      if (month < startMonth) year += 1;
      const date = isoDate(year, month, day);
      if (date < period.start_date || date > period.end_date) continue;
      const weekIndex = Math.floor(daysBetween(period.week1_start_date, date) / 7) + 1;
      observations.push({
        date,
        weekIndex,
        parity,
        ref: `${companionSheet.name}!${dateCell.ref}`,
      });
    }
  }

  if (!observations.length) {
    const error = new Error('IZH-WEEKLY parity evidence missing');
    error.code = 'IZH_PARITY_EVIDENCE_MISSING';
    throw error;
  }

  const mapping = new Map();
  for (const observation of observations) {
    const weekRemainder = observation.weekIndex % 2;
    const previous = mapping.get(weekRemainder);
    if (previous && previous !== observation.parity) {
      const error = new Error(`IZH-WEEKLY parity conflict at ${observation.date}`);
      error.code = 'IZH_PARITY_CONFLICT';
      throw error;
    }
    mapping.set(weekRemainder, observation.parity);
  }

  if (mapping.size !== 2 || new Set(mapping.values()).size !== 2) {
    const error = new Error('IZH-WEEKLY parity evidence is incomplete');
    error.code = 'IZH_PARITY_EVIDENCE_INCOMPLETE';
    throw error;
  }

  return { mapping, observations };
}

function dateSet(period, weekday, parity, parityMap) {
  const dates = [];
  for (let date = period.start_date; date <= period.end_date; date = addDays(date, 1)) {
    if (isoWeekday(date) !== weekday) continue;
    const weekIndex = Math.floor(daysBetween(period.week1_start_date, date) / 7) + 1;
    if (parity && parityMap.get(weekIndex % 2) !== parity) continue;
    dates.push(date);
  }
  return dates;
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

function groupHeaders(sheet) {
  const candidates = sheet.cells.filter(
    (cell) => /^\d{3,4}$/.test(norm(cell.value)) && cell.row <= 10,
  );
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const selected = [...byRow.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  if (!selected || selected[1].length < 2) {
    const error = new Error('IZH-WEEKLY group header row missing');
    error.code = 'IZH_GROUP_HEADER_MISSING';
    throw error;
  }
  return {
    row: selected[0],
    groups: selected[1]
      .sort((left, right) => left.col - right.col)
      .map((cell) => ({ col: cell.col, group: norm(cell.value), ref: cell.ref })),
  };
}

function streamWideBlocks(sheet, firstGroupColumn, lastGroupColumn, dayMap) {
  const blocks = [];
  for (const merge of sheet.merges) {
    if (merge.startCol > firstGroupColumn || merge.endCol < lastGroupColumn) continue;
    const day = dayMap.get(merge.startRow);
    if (!day) continue;
    const anchor = sheet.cells.find(
      (cell) => cell.row === merge.startRow && cell.col === merge.startCol,
    );
    const value = anchor?.value ?? '';
    if (!norm(value)) continue;
    blocks.push({
      ref: anchor?.ref ?? merge.startRef,
      row: merge.startRow,
      value,
      day,
      merge: merge.ref,
      reason: 'stream_wide_companion_owned',
      ruleIds: ['IZH-W03', 'IZH-W10'],
    });
  }
  return blocks;
}

function timeInfo(value) {
  const text = String(value || '').replace(/^\s*_+\s*/, '').trim();
  const rangeRegex = /(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/g;
  const ranges = [];
  let match;
  while ((match = rangeRegex.exec(text))) {
    if (match.index > 80) break;
    ranges.push({ start: match[1], end: match[2], raw: match[0] });
  }

  if (ranges.length) {
    const prefix = text.match(/^\s*(?:\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}\s*;?\s*)+/);
    const cut = prefix?.[0]?.length ?? 0;
    return {
      start: ranges[0].start,
      end: ranges.at(-1).end,
      slots: ranges,
      textAfter: text.slice(cut).trim(),
      startOnly: false,
    };
  }

  const startOnly = text.match(/^(\d{1,2}[.:]\d{2})\b\s*/);
  if (startOnly) {
    return {
      start: startOnly[1],
      end: null,
      slots: [],
      textAfter: text.slice(startOnly[0].length).trim(),
      startOnly: true,
    };
  }
  return null;
}

function cleanDiscipline(value) {
  return norm(String(value || '').replace(/^[_\-–;:,.\s]+/, '').replace(/[_\s]+$/, ''));
}

function parityDisciplines(cell, afterTime) {
  const underlined = cleanDiscipline(
    cell.runs.filter((run) => run.underline).map((run) => run.text).join(' '),
  );
  if (!underlined) return null;

  const plain = cleanDiscipline(afterTime);
  const index = plain.toLowerCase().indexOf(underlined.toLowerCase());
  if (index < 0) return null;
  const before = cleanDiscipline(plain.slice(0, index));
  const after = cleanDiscipline(plain.slice(index + underlined.length));
  if (before || !after) return null;
  return { above: underlined, below: after };
}

function normalizeClock(value) {
  const match = String(value || '').match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function lessonSeries({ cell, group, day, period, parityMap }) {
  const time = timeInfo(cell.value);
  if (!time) {
    return [{
      group,
      status: 'needs_review',
      warning: 'missing_time',
      warnings: ['missing_time'],
      discipline: cleanDiscipline(cell.value),
      dates: [],
      startTime: null,
      endTime: null,
      ruleIds: ['IZH-W01', 'IZH-W02', 'IZH-W03', 'IZH-W09'],
      references: [{ role: 'lesson', range: `расписание!${cell.ref}` }],
      rawSource: cell.value,
    }];
  }

  const base = {
    group,
    startTime: normalizeClock(time.start),
    endTime: time.end ? normalizeClock(time.end) : null,
    sourceSlots: time.slots.map((slot) => ({
      start: normalizeClock(slot.start),
      end: normalizeClock(slot.end),
    })),
    references: [{ role: 'lesson', range: `расписание!${cell.ref}` }],
    rawSource: cell.value,
    weekday: day.weekday,
    weekdayLabel: day.label,
  };

  if (time.startOnly) {
    return [{
      ...base,
      discipline: cleanDiscipline(time.textAfter),
      dates: dateSet(period, day.weekday, null, parityMap),
      status: 'needs_review',
      warning: 'end_time_missing_in_source',
      warnings: ['end_time_missing_in_source'],
      ruleIds: ['IZH-W01', 'IZH-W02', 'IZH-W03', 'IZH-W09'],
    }];
  }

  const parityPair = parityDisciplines(cell, time.textAfter);
  if (parityPair) {
    return [
      {
        ...base,
        discipline: parityPair.above,
        parity: 'above_line',
        dates: dateSet(period, day.weekday, 'above_line', parityMap),
        status: 'ok',
        warnings: [],
        ruleIds: ['IZH-W01', 'IZH-W02', 'IZH-W03', 'IZH-W04', 'IZH-W06', 'IZH-W07', 'IZH-W08'],
      },
      {
        ...base,
        discipline: parityPair.below,
        parity: 'below_line',
        dates: dateSet(period, day.weekday, 'below_line', parityMap),
        status: 'ok',
        warnings: [],
        ruleIds: ['IZH-W01', 'IZH-W02', 'IZH-W03', 'IZH-W04', 'IZH-W06', 'IZH-W07', 'IZH-W08'],
      },
    ];
  }

  return [{
    ...base,
    discipline: cleanDiscipline(time.textAfter),
    dates: dateSet(period, day.weekday, null, parityMap),
    status: 'ok',
    warnings: [],
    ruleIds: [
      'IZH-W01',
      'IZH-W02',
      'IZH-W03',
      'IZH-W04',
      ...(time.slots.length > 1 ? ['IZH-W05'] : []),
      'IZH-W07',
      'IZH-W08',
    ],
  }];
}

export function parseIzhgmuWeeklyStructures({ classStructure, companionStructure, groupCode }) {
  const classSheet = classStructure?.sheets?.find((sheet) => sheet.name.toLowerCase().includes('расписание'));
  const companionSheet = companionStructure?.sheets?.find((sheet) => sheet.name.toLowerCase().includes('расписание'));
  if (!classSheet || !companionSheet) {
    const error = new Error('IZH-WEEKLY required sheets missing');
    error.code = 'IZH_REQUIRED_SHEET_MISSING';
    throw error;
  }

  const { groups } = groupHeaders(classSheet);
  const target = groups.find((group) => group.group === String(groupCode));
  if (!target) {
    const error = new Error(`IZH-WEEKLY group ${groupCode} not found`);
    error.code = 'IZH_GROUP_NOT_FOUND';
    throw error;
  }

  const rows = dayRows(classSheet);
  const wideBlocks = streamWideBlocks(classSheet, groups[0].col, groups.at(-1).col, rows);
  const wideRows = new Set(wideBlocks.flatMap((block) => {
    const merge = classSheet.merges.find((item) => item.ref === block.merge);
    if (!merge) return [block.row];
    return Array.from({ length: merge.endRow - merge.startRow + 1 }, (_, index) => merge.startRow + index);
  }));

  const period = parsePeriod(companionSheet);
  const parity = inferParity(companionSheet, period);
  const series = [];
  const deferred = wideBlocks.map((block) => ({
    ref: block.ref,
    row: block.row,
    value: block.value,
    weekday: block.day.weekday,
    weekdayLabel: block.day.label,
    merge: block.merge,
    reason: block.reason,
    ruleIds: block.ruleIds,
  }));

  for (const cell of classSheet.cells.filter((item) => item.col === target.col && item.row > 5)) {
    const day = rows.get(cell.row);
    if (!day || wideRows.has(cell.row)) continue;
    series.push(...lessonSeries({
      cell,
      group: target.group,
      day,
      period,
      parityMap: parity.mapping,
    }));
  }

  const reviewRequired = series.filter((item) => item.status === 'needs_review');
  return {
    profile: 'IZH-WEEKLY',
    group: target.group,
    groups: groups.map((item) => item.group),
    period,
    parity: {
      odd: parity.mapping.get(1),
      even: parity.mapping.get(0),
      evidenceCount: parity.observations.length,
      references: [...new Set(parity.observations.slice(0, 12).map((item) => item.ref))],
    },
    series,
    deferred,
    reviewRequired,
    publishable: reviewRequired.length === 0 && deferred.length === 0,
  };
}

export async function parseIzhgmuWeeklyPair({ classBuffer, companionBuffer, groupCode }) {
  const [classStructure, companionStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(companionBuffer),
  ]);
  return parseIzhgmuWeeklyStructures({ classStructure, companionStructure, groupCode });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await parseIzhgmuWeeklyPair({
    classBuffer: await fs.readFile(process.argv[2]),
    companionBuffer: await fs.readFile(process.argv[3]),
    groupCode: process.argv[4] || '109',
  });
  console.log(JSON.stringify({
    profile: result.profile,
    group: result.group,
    period: result.period,
    parity: result.parity,
    seriesCount: result.series.length,
    eventCount: result.series.reduce((count, item) => count + item.dates.length, 0),
    publishable: result.publishable,
    reviewRequired: result.reviewRequired.map((item) => ({
      discipline: item.discipline,
      start: item.startTime,
      warning: item.warning,
      ref: item.references[0].range,
    })),
    deferred: result.deferred.length,
    deferredExamples: result.deferred.slice(0, 4),
    examples: result.series.slice(0, 6),
  }, null, 2));
}
