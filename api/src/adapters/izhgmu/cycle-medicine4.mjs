import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['пн', 1], ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6], ['вс', 7],
]);

const MONTH_INDEX = new Map([
  ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
  ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
]);

const DISCIPLINE_ALIASES = Object.freeze([
  { alias: 'дерматовенер', discipline: 'Дерматовенерология', metadataKey: 'dermatovenereology' },
  { alias: 'медицреабил', discipline: 'Медицинская реабилитация', metadataKey: 'rehabilitation' },
  { alias: 'гинекология', discipline: 'Гинекология', metadataKey: 'gynecology' },
  { alias: 'неврология', discipline: 'Неврология', metadataKey: 'neurology' },
  { alias: 'педиатрия', discipline: 'Педиатрия', metadataKey: 'pediatrics' },
  { alias: 'факултхир', discipline: 'Факультетская хирургия', metadataKey: 'faculty_surgery' },
  { alias: 'факултер', discipline: 'Факультетская терапия', metadataKey: 'faculty_therapy' },
  { alias: 'психиатр', discipline: 'Психиатрия', metadataKey: 'psychiatry' },
  { alias: 'уро', discipline: 'Урология', metadataKey: 'faculty_surgery', requiresSurgeryPair: true },
].sort((a, b) => b.alias.length - a.alias.length));

const DEPARTMENT_KEYS = Object.freeze([
  { key: 'neurology', test: /невролог/i },
  { key: 'faculty_therapy', test: /факультетск[а-яё]* терап/i },
  { key: 'gynecology', test: /гинеколог/i },
  { key: 'dermatovenereology', test: /дерматовенер/i },
  { key: 'faculty_surgery', test: /факультетск[а-яё]* хирург/i },
  { key: 'rehabilitation', test: /медицинск[а-яё]* реабил/i },
  { key: 'pediatrics', test: /де(?:тс|ст)к[а-яё]* инфекц/i },
  { key: 'psychiatry', test: /психиатр/i },
]);

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return norm(value).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/gi, '');
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

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoWeekday(iso) {
  const value = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return value === 0 ? 7 : value;
}

function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function clockRanges(value) {
  const ranges = [];
  for (const match of String(value || '').matchAll(/(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/g)) {
    ranges.push({ start: normalizeClock(match[1]), end: normalizeClock(match[2]) });
  }
  return ranges.filter((item) => item.start && item.end);
}

function sheetForCycle(structure) {
  const candidates = (structure?.sheets || []).filter((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^кафедра$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /^время$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /форма контроля/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /база практическ/i.test(norm(cell.value)))
  ));
  if (candidates.length !== 1) {
    const error = new Error(`IZH-CYCLE sheet is not unique: ${candidates.length}`);
    error.code = 'IZH_CYCLE_SHEET_MISSING';
    throw error;
  }
  return candidates[0];
}

function parsePeriod(sheet) {
  for (const cell of sheet.cells) {
    const text = norm(cell.value);
    if (!/начало .*семестра/i.test(text) || !/окончание/i.test(text)) continue;
    const match = text.match(/начало .*семестра\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\s*г?\.?\s*,?\s*окончание\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})/i);
    if (!match) continue;
    const startMonth = MONTH_INDEX.get(match[2].toLowerCase());
    const endMonth = MONTH_INDEX.get(match[5].toLowerCase());
    if (!startMonth || !endMonth) continue;
    return {
      start_date: isoDate(Number(match[3]), startMonth, Number(match[1])),
      end_date: isoDate(Number(match[6]), endMonth, Number(match[4])),
      week1_start_date: isoDate(Number(match[3]), startMonth, Number(match[1])),
      reference: `${sheet.name}!${cell.ref}`,
    };
  }
  const error = new Error('IZH-CYCLE semester period missing');
  error.code = 'IZH_CYCLE_PERIOD_MISSING';
  throw error;
}

function dateHeaders(sheet, period) {
  const maxRow = Math.min(15, Math.max(...sheet.cells.map((cell) => cell.row)));
  let best = null;
  for (let firstRow = 1; firstRow < maxRow; firstRow += 1) {
    const secondRow = firstRow + 1;
    const byCol = new Map();
    for (const cell of sheet.cells.filter((item) => item.row === firstRow || item.row === secondRow)) {
      if (!byCol.has(cell.col)) byCol.set(cell.col, []);
      byCol.get(cell.col).push(norm(cell.value).toLowerCase());
    }
    const columns = [];
    for (const [col, values] of byCol) {
      const day = values.map((value) => (/^\d{1,2}$/.test(value) ? Number(value) : null)).find(Number.isInteger) ?? null;
      const weekday = values.map((value) => DAY_INDEX.get(value) ?? null).find(Number.isInteger) ?? null;
      if (day && weekday) columns.push({ col, day, weekday });
    }
    columns.sort((a, b) => a.col - b.col);
    if (!best || columns.length > best.columns.length) best = { rows: [firstRow, secondRow], columns };
  }
  if (!best || best.columns.length < 30) {
    const error = new Error('IZH-CYCLE date header grid missing');
    error.code = 'IZH_CYCLE_DATE_HEADER_MISSING';
    throw error;
  }
  const firstCol = best.columns[0].col;
  const lastCol = best.columns.at(-1).col;
  if (best.columns.length !== lastCol - firstCol + 1) {
    const error = new Error('IZH-CYCLE date header has internal column gaps');
    error.code = 'IZH_CYCLE_DATE_HEADER_GAP';
    throw error;
  }

  const startYear = Number(period.start_date.slice(0, 4));
  const startMonth = Number(period.start_date.slice(5, 7));
  let year = startYear;
  let month = startMonth;
  let previousDay = null;
  const dates = new Map();
  for (const item of best.columns) {
    if (previousDay !== null && item.day < previousDay) {
      month += 1;
      if (month === 13) { month = 1; year += 1; }
    }
    const date = isoDate(year, month, item.day);
    if (isoWeekday(date) !== item.weekday) {
      const error = new Error(`IZH-CYCLE weekday mismatch at ${columnLetters(item.col)}: ${date}`);
      error.code = 'IZH_CYCLE_WEEKDAY_MISMATCH';
      throw error;
    }
    dates.set(item.col, date);
    previousDay = item.day;
  }
  if (dates.get(firstCol) !== period.start_date || dates.get(lastCol) !== period.end_date) {
    const error = new Error(`IZH-CYCLE header period mismatch: ${dates.get(firstCol)}..${dates.get(lastCol)}`);
    error.code = 'IZH_CYCLE_PERIOD_MISMATCH';
    throw error;
  }
  return { rows: best.rows, firstCol, lastCol, dates };
}

function groupRows(sheet, dateHeader, metadataRow) {
  return sheet.cells
    .filter((cell) => cell.col === 1 && cell.row > Math.max(...dateHeader.rows) && cell.row < metadataRow)
    .map((cell) => ({ cell, label: norm(cell.value) }))
    .filter((item) => /^\d{3,4}(?:\s*[-–]\s*\d{3,4})?$/.test(item.label));
}

function groupSpan(label) {
  const values = [...String(label).matchAll(/\d{3,4}/g)].map((match) => Number(match[0]));
  if (!values.length) return [];
  if (values.length === 1) return [String(values[0])];
  const [start, end] = values;
  if (end < start || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function tokenizedRow(sheet, row, firstCol, lastCol) {
  const cellsByCol = new Map(sheet.cells.filter((cell) => cell.row === row).map((cell) => [cell.col, cell]));
  const chars = [];
  for (let col = firstCol; col <= lastCol; col += 1) {
    const text = compact(cellsByCol.get(col)?.value);
    for (const ch of text) chars.push({ ch, col });
  }
  const text = chars.map((item) => item.ch).join('');
  if (!text) {
    const error = new Error(`IZH-CYCLE group row ${row} has no discipline text`);
    error.code = 'IZH_CYCLE_DISCIPLINE_ROW_EMPTY';
    throw error;
  }

  const tokens = [];
  let offset = 0;
  while (offset < text.length) {
    const token = DISCIPLINE_ALIASES.find((item) => text.startsWith(item.alias, offset));
    if (!token) {
      const error = new Error(`IZH-CYCLE unknown discipline token at row ${row}: ${text.slice(offset, offset + 24)}`);
      error.code = 'IZH_CYCLE_DISCIPLINE_TOKEN_UNKNOWN';
      error.row = row;
      error.offset = offset;
      throw error;
    }
    const first = chars[offset];
    const last = chars[offset + token.alias.length - 1];
    tokens.push({ ...token, firstLetterCol: first.col, lastLetterCol: last.col });
    offset += token.alias.length;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    token.startCol = token.firstLetterCol;
    token.endCol = index + 1 < tokens.length ? tokens[index + 1].firstLetterCol - 1 : lastCol;
    token.reference = `${sheet.name}!${columnLetters(token.startCol)}${row}:${columnLetters(token.endCol)}${row}`;
  }
  if (tokens[0]?.startCol !== firstCol || tokens.at(-1)?.endCol !== lastCol) {
    const error = new Error(`IZH-CYCLE group row ${row} does not cover the whole date grid`);
    error.code = 'IZH_CYCLE_DISCIPLINE_COVERAGE_GAP';
    throw error;
  }
  return tokens;
}

function assertSurgeryUrologyInvariant(allRows) {
  for (const row of allRows) {
    const tokens = row.tokens;
    const surgery = tokens.findIndex((item) => item.metadataKey === 'faculty_surgery' && !item.requiresSurgeryPair);
    const urology = tokens.findIndex((item) => item.requiresSurgeryPair);
    if (surgery < 0 || urology !== surgery + 1) {
      const error = new Error(`IZH-CYCLE surgery/urology structural pair changed at row ${row.row}`);
      error.code = 'IZH_CYCLE_UROLOGY_PAIR_CHANGED';
      throw error;
    }
    const surgeryDays = tokens[surgery].endCol - tokens[surgery].startCol + 1;
    const urologyDays = tokens[urology].endCol - tokens[urology].startCol + 1;
    if (surgeryDays !== 10 || urologyDays !== 3) {
      const error = new Error(`IZH-CYCLE surgery/urology durations changed at row ${row.row}`);
      error.code = 'IZH_CYCLE_UROLOGY_PAIR_DURATION_CHANGED';
      throw error;
    }
  }
}

function metadataKey(value) {
  const text = norm(value);
  const matches = DEPARTMENT_KEYS.filter((item) => item.test.test(text));
  return matches.length === 1 ? matches[0].key : null;
}

function metadataBlocks(sheet, metadataRow) {
  const merged = sheet.merges
    .filter((merge) => merge.startRow === metadataRow && merge.endRow === metadataRow && merge.startCol > 1)
    .sort((a, b) => a.startCol - b.startCol);
  const byCell = new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const result = new Map();
  for (const merge of merged) {
    const departmentCell = byCell.get(`${metadataRow}:${merge.startCol}`);
    const department = norm(departmentCell?.value);
    if (!department) continue;
    const key = metadataKey(department);
    if (!key) {
      const error = new Error(`IZH-CYCLE unknown department metadata: ${department}`);
      error.code = 'IZH_CYCLE_DEPARTMENT_UNKNOWN';
      throw error;
    }
    if (result.has(key)) {
      const error = new Error(`IZH-CYCLE duplicate department metadata: ${key}`);
      error.code = 'IZH_CYCLE_DEPARTMENT_DUPLICATE';
      throw error;
    }
    const timeCell = byCell.get(`${metadataRow + 1}:${merge.startCol}`);
    const assessmentCell = byCell.get(`${metadataRow + 2}:${merge.startCol}`);
    const locationCell = byCell.get(`${metadataRow + 3}:${merge.startCol}`);
    const slots = clockRanges(timeCell?.value);
    if (!slots.length) {
      const error = new Error(`IZH-CYCLE time metadata missing for ${department}`);
      error.code = 'IZH_CYCLE_TIME_MISSING';
      throw error;
    }
    result.set(key, {
      key,
      department,
      startTime: slots[0].start,
      endTime: slots.at(-1).end,
      sourceSlots: slots,
      assessment: norm(assessmentCell?.value) || null,
      location: norm(locationCell?.value) || null,
      references: {
        department: `${sheet.name}!${departmentCell.ref}`,
        time: `${sheet.name}!${timeCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 1}`}`,
        assessment: `${sheet.name}!${assessmentCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 2}`}`,
        location: `${sheet.name}!${locationCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 3}`}`,
      },
    });
  }
  const required = new Set(DEPARTMENT_KEYS.map((item) => item.key));
  const missing = [...required].filter((key) => !result.has(key));
  if (missing.length) {
    const error = new Error(`IZH-CYCLE department metadata incomplete: ${missing.join(', ')}`);
    error.code = 'IZH_CYCLE_DEPARTMENT_INCOMPLETE';
    throw error;
  }
  return result;
}

export function parseIzhgmuMedicine4CycleStructures({ structure, groupCode }) {
  const sheet = sheetForCycle(structure);
  const period = parsePeriod(sheet);
  const metadataAnchor = sheet.cells.find((cell) => cell.col === 1 && /^кафедра$/i.test(norm(cell.value)));
  const metadataRow = metadataAnchor?.row ?? null;
  if (!metadataRow) {
    const error = new Error('IZH-CYCLE metadata block missing');
    error.code = 'IZH_CYCLE_METADATA_MISSING';
    throw error;
  }
  const headers = dateHeaders(sheet, period);
  const rows = groupRows(sheet, headers, metadataRow);
  if (!rows.length) {
    const error = new Error('IZH-CYCLE group rows missing');
    error.code = 'IZH_CYCLE_GROUP_ROWS_MISSING';
    throw error;
  }

  const parsedRows = rows.map(({ cell, label }) => ({
    row: cell.row,
    label,
    groups: groupSpan(label),
    tokens: tokenizedRow(sheet, cell.row, headers.firstCol, headers.lastCol),
  }));
  if (parsedRows.some((row) => !row.groups.length)) {
    const error = new Error('IZH-CYCLE invalid group span');
    error.code = 'IZH_CYCLE_GROUP_SPAN_INVALID';
    throw error;
  }
  assertSurgeryUrologyInvariant(parsedRows);

  const targetCode = String(groupCode);
  const matches = parsedRows.filter((row) => row.groups.includes(targetCode));
  if (matches.length !== 1) {
    const error = new Error(`IZH-CYCLE group ${targetCode} matched ${matches.length} rows`);
    error.code = 'IZH_CYCLE_GROUP_NOT_UNIQUE';
    throw error;
  }
  const target = matches[0];
  const metadata = metadataBlocks(sheet, metadataRow);
  const dateRefs = `${sheet.name}!${columnLetters(headers.firstCol)}${headers.rows[0]}:${columnLetters(headers.lastCol)}${headers.rows[1]}`;

  const series = target.tokens.map((token) => {
    const meta = metadata.get(token.metadataKey);
    const dates = [];
    for (let col = token.startCol; col <= token.endCol; col += 1) {
      const date = headers.dates.get(col);
      if (!date) {
        const error = new Error(`IZH-CYCLE date missing at ${columnLetters(col)}`);
        error.code = 'IZH_CYCLE_DATE_COLUMN_UNMAPPED';
        throw error;
      }
      dates.push(date);
    }
    return {
      sourceRole: 'cycle',
      sourceSheet: sheet.name,
      group: targetCode,
      sourceGroupSpan: target.label,
      jointGroups: target.groups.filter((group) => group !== targetCode),
      discipline: token.discipline,
      department: meta.department,
      startTime: meta.startTime,
      endTime: meta.endTime,
      sourceSlots: meta.sourceSlots,
      location: meta.location,
      assessment: meta.assessment,
      lessonType: { raw: 'практические занятия', code: 'practice' },
      dates,
      status: 'ok',
      warnings: [],
      ruleIds: [
        'IZH-C01', 'IZH-C02', 'IZH-C03', 'IZH-C04', 'IZH-C05',
        ...(token.requiresSurgeryPair ? ['IZH-C06'] : []),
        'IZH-C07', 'IZH-C08',
      ],
      references: [
        { role: 'discipline', range: token.reference },
        { role: 'date', range: dateRefs },
        { role: 'time', range: meta.references.time },
        { role: 'location', range: meta.references.location },
        { role: 'note', range: meta.references.department },
        { role: 'note', range: meta.references.assessment },
      ],
      rawSource: `${token.discipline}; ${meta.department}; ${meta.startTime}-${meta.endTime}${meta.location ? `; ${meta.location}` : ''}`,
    };
  });

  const eventCount = series.reduce((sum, item) => sum + item.dates.length, 0);
  const sourceDateCount = headers.lastCol - headers.firstCol + 1;
  if (eventCount !== sourceDateCount) {
    const error = new Error(`IZH-CYCLE event coverage mismatch ${eventCount}/${sourceDateCount}`);
    error.code = 'IZH_CYCLE_EVENT_COVERAGE_MISMATCH';
    throw error;
  }

  return {
    profile: 'IZH-CYCLE',
    parserVersion: 'izhgmu-cycle-v1',
    group: targetCode,
    sourceGroupSpan: target.label,
    period,
    series,
    reviewRequired: [],
    deferred: [],
    warnings: [],
    stats: {
      dateColumns: sourceDateCount,
      groupRows: parsedRows.length,
      sourceSeries: series.length,
      eventCount,
      jointGroupCount: target.groups.length,
    },
    publishable: true,
  };
}

export async function parseIzhgmuMedicine4CycleWorkbook(buffer, { groupCode }) {
  return parseIzhgmuMedicine4CycleStructures({ structure: await readIzhgmuXlsxStructure(buffer), groupCode });
}
