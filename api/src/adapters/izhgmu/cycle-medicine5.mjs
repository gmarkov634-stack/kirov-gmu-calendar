import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['пн', 1], ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6], ['вс', 7],
]);

const MONTH_INDEX = new Map([
  ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
  ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
]);

const TOKENS = Object.freeze([
  { token: 'ГоспитХир', discipline: 'Госпитальная хирургия', metadataKey: 'hospital_surgery', expectedDays: 11 },
  { token: 'Акушерство', discipline: 'Акушерство', metadataKey: 'obstetrics_gynecology', expectedDays: 14 },
  { token: 'Инфекцболезни', discipline: 'Инфекционные болезни', metadataKey: 'infectious_diseases', expectedDays: 16 },
  { token: 'ТравматиОрт', discipline: 'Травматология и ортопедия', metadataKey: 'traumatology', expectedDays: 13 },
  { token: 'Госптерапия', discipline: 'Госпитальная терапия', metadataKey: 'hospital_therapy', expectedDays: 13 },
  { token: 'Поликлтер', discipline: 'Поликлиническая терапия', metadataKey: 'outpatient_therapy', expectedDays: 13 },
  { token: 'Избвптер', discipline: 'Избр. вопр. терапии', metadataKey: 'internal_diseases', expectedDays: 8, glossaryConfirmed: true },
  { token: 'Медправо', discipline: 'Мед-прав. основы', metadataKey: 'forensic_medicine', expectedDays: 8, glossaryConfirmed: true },
  { token: 'Дисвыб', discipline: 'Дисциплина по выбору', metadataKey: 'elective', expectedDays: 7, elective: true },
].sort((left, right) => right.token.length - left.token.length));

const REQUIRED_TOKEN_NAMES = new Set(TOKENS.map((item) => item.token));

const CORE_METADATA = Object.freeze([
  { key: 'hospital_therapy', test: /госпитальн[а-яё]* терап/i },
  { key: 'internal_diseases', test: /внутренн[а-яё]* болезн/i },
  { key: 'obstetrics_gynecology', test: /акушерств[а-яё]*.*гинеколог/i },
  { key: 'hospital_surgery', test: /госпитальн[а-яё]* хирург/i },
  { key: 'forensic_medicine', test: /судебн[а-яё]* медиц/i },
  { key: 'infectious_diseases', test: /инфекционн[а-яё]* болезн/i },
  { key: 'outpatient_therapy', test: /поликлиническ[а-яё]* терап/i },
  { key: 'traumatology', test: /травматолог[а-яё]*.*ортопед/i },
]);

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return norm(value).replace(/\s+/g, '');
}

function columnLetters(value) {
  let n = Number(value);
  let output = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    n = Math.floor((n - 1) / 26);
  }
  return output;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoWeekday(iso) {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function clockRanges(value) {
  return [...String(value || '').matchAll(/(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/g)]
    .map((match) => ({ start: normalizeClock(match[1]), end: normalizeClock(match[2]) }))
    .filter((item) => item.start && item.end);
}

function cycleSheet(structure) {
  const candidates = (structure?.sheets || []).filter((sheet) => (
    sheet.cells.some((cell) => cell.col === 1 && /^кафедра$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /^время$/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /форма контроля/i.test(norm(cell.value)))
    && sheet.cells.some((cell) => cell.col === 1 && /база практическ/i.test(norm(cell.value)))
  ));
  if (candidates.length !== 1) {
    const error = new Error(`IZH-CYCLE medicine-5 sheet is not unique: ${candidates.length}`);
    error.code = 'IZH_CYCLE_M5_SHEET_NOT_UNIQUE';
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
  const error = new Error('IZH-CYCLE medicine-5 semester period missing');
  error.code = 'IZH_CYCLE_M5_PERIOD_MISSING';
  throw error;
}

function dateHeaders(sheet, period) {
  const maxRow = Math.min(15, Math.max(...sheet.cells.map((cell) => cell.row)));
  let best = null;
  for (let firstRow = 1; firstRow < maxRow; firstRow += 1) {
    const secondRow = firstRow + 1;
    const byColumn = new Map();
    for (const cell of sheet.cells.filter((item) => item.row === firstRow || item.row === secondRow)) {
      if (!byColumn.has(cell.col)) byColumn.set(cell.col, []);
      byColumn.get(cell.col).push(norm(cell.value).toLowerCase());
    }
    const columns = [];
    for (const [col, values] of byColumn) {
      const day = values.map((value) => (/^\d{1,2}$/.test(value) ? Number(value) : null)).find(Number.isInteger) ?? null;
      const weekday = values.map((value) => DAY_INDEX.get(value) ?? null).find(Number.isInteger) ?? null;
      if (day && weekday) columns.push({ col, day, weekday });
    }
    columns.sort((left, right) => left.col - right.col);
    if (!best || columns.length > best.columns.length) best = { rows: [firstRow, secondRow], columns };
  }
  if (!best || best.columns.length < 30) {
    const error = new Error('IZH-CYCLE medicine-5 date grid missing');
    error.code = 'IZH_CYCLE_M5_DATE_GRID_MISSING';
    throw error;
  }
  const firstCol = best.columns[0].col;
  const lastCol = best.columns.at(-1).col;
  if (best.columns.length !== lastCol - firstCol + 1) {
    const error = new Error('IZH-CYCLE medicine-5 date grid has internal column gaps');
    error.code = 'IZH_CYCLE_M5_DATE_GRID_GAP';
    throw error;
  }

  let year = Number(period.start_date.slice(0, 4));
  let month = Number(period.start_date.slice(5, 7));
  let previousDay = null;
  const dates = new Map();
  for (const item of best.columns) {
    if (previousDay !== null && item.day < previousDay) {
      month += 1;
      if (month === 13) { month = 1; year += 1; }
    }
    const date = isoDate(year, month, item.day);
    if (isoWeekday(date) !== item.weekday) {
      const error = new Error(`IZH-CYCLE medicine-5 weekday mismatch at ${columnLetters(item.col)}: ${date}`);
      error.code = 'IZH_CYCLE_M5_WEEKDAY_MISMATCH';
      throw error;
    }
    dates.set(item.col, date);
    previousDay = item.day;
  }
  if (dates.get(firstCol) !== period.start_date || dates.get(lastCol) !== period.end_date) {
    const error = new Error(`IZH-CYCLE medicine-5 source period mismatch: ${dates.get(firstCol)}..${dates.get(lastCol)}`);
    error.code = 'IZH_CYCLE_M5_PERIOD_MISMATCH';
    throw error;
  }
  return { rows: best.rows, firstCol, lastCol, dates };
}

function groupSpan(label) {
  const values = [...String(label).matchAll(/\d{3,4}/g)].map((match) => Number(match[0]));
  if (!values.length) return [];
  if (values.length === 1) return [String(values[0])];
  const [start, end] = values;
  if (end < start || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function groupRows(sheet, headers, metadataRow) {
  return sheet.cells
    .filter((cell) => cell.col === 1 && cell.row > Math.max(...headers.rows) && cell.row < metadataRow)
    .map((cell) => ({ row: cell.row, label: norm(cell.value), groups: groupSpan(cell.value) }))
    .filter((item) => /^\d{3,4}(?:\s*[-–]\s*\d{3,4})?$/.test(item.label));
}

function parseTokenRow(sheet, row, headers) {
  const cellsByColumn = new Map(sheet.cells.filter((cell) => cell.row === row).map((cell) => [cell.col, cell]));
  const chars = [];
  for (let col = headers.firstCol; col <= headers.lastCol; col += 1) {
    const text = compact(cellsByColumn.get(col)?.value);
    for (const char of text) chars.push({ char, col });
  }
  const text = chars.map((item) => item.char).join('');
  const parsed = [];
  let offset = 0;
  while (offset < text.length) {
    const definition = TOKENS.find((item) => text.startsWith(item.token, offset));
    if (!definition) {
      const error = new Error(`IZH-CYCLE medicine-5 unknown token at row ${row}: ${text.slice(offset, offset + 24)}`);
      error.code = 'IZH_CYCLE_M5_TOKEN_UNKNOWN';
      error.row = row;
      throw error;
    }
    const firstLetterCol = chars[offset].col;
    const nextOffset = offset + definition.token.length;
    const nextTokenCol = nextOffset < chars.length ? chars[nextOffset].col : headers.lastCol + 1;
    const startCol = firstLetterCol;
    const endCol = nextTokenCol - 1;
    const dates = [];
    for (let col = startCol; col <= endCol; col += 1) {
      const date = headers.dates.get(col);
      if (!date) {
        const error = new Error(`IZH-CYCLE medicine-5 token has unmapped date column ${columnLetters(col)}${row}`);
        error.code = 'IZH_CYCLE_M5_TOKEN_DATE_UNMAPPED';
        throw error;
      }
      dates.push(date);
    }
    parsed.push({
      ...definition,
      startCol,
      endCol,
      dates,
      reference: `${sheet.name}!${columnLetters(startCol)}${row}:${columnLetters(endCol)}${row}`,
    });
    offset = nextOffset;
  }

  const names = parsed.map((item) => item.token);
  if (names.length !== REQUIRED_TOKEN_NAMES.size || new Set(names).size !== REQUIRED_TOKEN_NAMES.size) {
    const error = new Error(`IZH-CYCLE medicine-5 token set changed at row ${row}: ${names.join(', ')}`);
    error.code = 'IZH_CYCLE_M5_TOKEN_SET_CHANGED';
    throw error;
  }
  for (const required of REQUIRED_TOKEN_NAMES) {
    if (!names.includes(required)) {
      const error = new Error(`IZH-CYCLE medicine-5 token ${required} missing at row ${row}`);
      error.code = 'IZH_CYCLE_M5_TOKEN_MISSING';
      throw error;
    }
  }
  for (const item of parsed) {
    if (item.dates.length !== item.expectedDays) {
      const error = new Error(`IZH-CYCLE medicine-5 ${item.token} duration changed at row ${row}: ${item.dates.length}/${item.expectedDays}`);
      error.code = 'IZH_CYCLE_M5_TOKEN_DURATION_CHANGED';
      throw error;
    }
  }
  const elective = parsed.find((item) => item.elective);
  if (!elective || elective !== parsed.at(-1)) {
    const error = new Error(`IZH-CYCLE medicine-5 elective placeholder is not the final token at row ${row}`);
    error.code = 'IZH_CYCLE_M5_ELECTIVE_POSITION_CHANGED';
    throw error;
  }
  if (parsed.reduce((sum, item) => sum + item.dates.length, 0) !== headers.dates.size) {
    const error = new Error(`IZH-CYCLE medicine-5 row ${row} does not cover the source calendar`);
    error.code = 'IZH_CYCLE_M5_ROW_COVERAGE_CHANGED';
    throw error;
  }
  return parsed;
}

function classifyMetadata(department) {
  const text = norm(department);
  if (/^д\s*в\s*4\b/i.test(text)) return { kind: 'elective', key: null };
  const matches = CORE_METADATA.filter((item) => item.test.test(text));
  if (matches.length === 1) return { kind: 'core', key: matches[0].key };
  return { kind: 'unknown', key: null };
}

function metadataBlocks(sheet, metadataRow) {
  const cells = new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const merges = sheet.merges
    .filter((merge) => merge.startRow === metadataRow && merge.endRow === metadataRow && merge.startCol > 1)
    .sort((left, right) => left.startCol - right.startCol);
  const core = new Map();
  const electives = [];

  for (const merge of merges) {
    const departmentCell = cells.get(`${metadataRow}:${merge.startCol}`);
    const department = norm(departmentCell?.value);
    if (!department) continue;
    const classification = classifyMetadata(department);
    if (classification.kind === 'unknown') {
      const error = new Error(`IZH-CYCLE medicine-5 unknown metadata block: ${department}`);
      error.code = 'IZH_CYCLE_M5_METADATA_UNKNOWN';
      throw error;
    }
    const timeCell = cells.get(`${metadataRow + 1}:${merge.startCol}`);
    const controlCell = cells.get(`${metadataRow + 2}:${merge.startCol}`);
    const locationCell = cells.get(`${metadataRow + 3}:${merge.startCol}`);
    const slots = clockRanges(timeCell?.value);
    if (!slots.length) {
      const error = new Error(`IZH-CYCLE medicine-5 time metadata missing: ${department}`);
      error.code = 'IZH_CYCLE_M5_TIME_MISSING';
      throw error;
    }
    const block = {
      department,
      startTime: slots[0].start,
      endTime: slots.at(-1).end,
      sourceSlots: slots,
      assessment: norm(controlCell?.value) || null,
      location: norm(locationCell?.value) || null,
      references: {
        department: `${sheet.name}!${departmentCell.ref}`,
        time: `${sheet.name}!${timeCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 1}`}`,
        assessment: `${sheet.name}!${controlCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 2}`}`,
        location: `${sheet.name}!${locationCell?.ref ?? `${columnLetters(merge.startCol)}${metadataRow + 3}`}`,
      },
    };
    if (classification.kind === 'core') {
      if (core.has(classification.key)) {
        const error = new Error(`IZH-CYCLE medicine-5 duplicate core metadata: ${classification.key}`);
        error.code = 'IZH_CYCLE_M5_METADATA_DUPLICATE';
        throw error;
      }
      core.set(classification.key, block);
    } else {
      const discipline = department.replace(/^\s*д\s*в\s*4\s*/i, '').trim();
      electives.push({ ...block, discipline });
    }
  }

  const requiredCore = new Set(CORE_METADATA.map((item) => item.key));
  const missing = [...requiredCore].filter((key) => !core.has(key));
  if (core.size !== requiredCore.size || missing.length) {
    const error = new Error(`IZH-CYCLE medicine-5 core metadata changed; missing: ${missing.join(', ')}`);
    error.code = 'IZH_CYCLE_M5_METADATA_INCOMPLETE';
    throw error;
  }
  if (electives.length !== 6 || new Set(electives.map((item) => item.discipline)).size !== 6) {
    const error = new Error(`IZH-CYCLE medicine-5 elective metadata changed: ${electives.length}`);
    error.code = 'IZH_CYCLE_M5_ELECTIVE_SET_CHANGED';
    throw error;
  }
  return { core, electives };
}

function sameDates(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function parseIzhgmuMedicine5CycleStructures({ structure, groupCode }) {
  const sheet = cycleSheet(structure);
  const period = parsePeriod(sheet);
  const metadataAnchor = sheet.cells.find((cell) => cell.col === 1 && /^кафедра$/i.test(norm(cell.value)));
  if (!metadataAnchor) {
    const error = new Error('IZH-CYCLE medicine-5 metadata block missing');
    error.code = 'IZH_CYCLE_M5_METADATA_MISSING';
    throw error;
  }
  const headers = dateHeaders(sheet, period);
  const rows = groupRows(sheet, headers, metadataAnchor.row);
  if (rows.length !== 14) {
    const error = new Error(`IZH-CYCLE medicine-5 group-span count changed: ${rows.length}/14`);
    error.code = 'IZH_CYCLE_M5_GROUP_COUNT_CHANGED';
    throw error;
  }

  const parsedRows = rows.map((row) => ({ ...row, tokens: parseTokenRow(sheet, row.row, headers) }));
  const baselineDurations = new Map(parsedRows[0].tokens.map((item) => [item.token, item.dates.length]));
  const baselineElectiveDates = parsedRows[0].tokens.find((item) => item.elective).dates;
  for (const row of parsedRows.slice(1)) {
    for (const token of row.tokens) {
      if (baselineDurations.get(token.token) !== token.dates.length) {
        const error = new Error(`IZH-CYCLE medicine-5 cross-row duration changed for ${token.token}`);
        error.code = 'IZH_CYCLE_M5_CROSS_ROW_DURATION_CHANGED';
        throw error;
      }
    }
    const electiveDates = row.tokens.find((item) => item.elective).dates;
    if (!sameDates(electiveDates, baselineElectiveDates)) {
      const error = new Error(`IZH-CYCLE medicine-5 elective dates differ between group spans`);
      error.code = 'IZH_CYCLE_M5_ELECTIVE_DATES_CHANGED';
      throw error;
    }
  }

  const targetGroup = String(groupCode);
  const targetRows = parsedRows.filter((row) => row.groups.includes(targetGroup));
  if (targetRows.length !== 1) {
    const error = new Error(`IZH-CYCLE medicine-5 group ${targetGroup} matched ${targetRows.length} rows`);
    error.code = 'IZH_CYCLE_M5_GROUP_NOT_UNIQUE';
    throw error;
  }
  const target = targetRows[0];
  const metadata = metadataBlocks(sheet, metadataAnchor.row);
  const dateReference = `${sheet.name}!${columnLetters(headers.firstCol)}${headers.rows[0]}:${columnLetters(headers.lastCol)}${headers.rows[1]}`;

  const series = target.tokens.filter((item) => !item.elective).map((token) => {
    const block = metadata.core.get(token.metadataKey);
    return {
      sourceRole: 'cycle',
      sourceSheet: sheet.name,
      group: targetGroup,
      sourceGroupSpan: target.label,
      jointGroups: target.groups.filter((group) => group !== targetGroup),
      discipline: token.discipline,
      disciplineRaw: token.token,
      department: block.department,
      startTime: block.startTime,
      endTime: block.endTime,
      sourceSlots: block.sourceSlots,
      location: block.location,
      assessment: block.assessment,
      lessonType: { raw: 'практические занятия', code: 'practice' },
      dates: token.dates,
      status: 'ok',
      warnings: [],
      ruleIds: [
        'IZH-C01', 'IZH-C02', 'IZH-C03', 'IZH-C04', 'IZH-C07', 'IZH-C08', 'IZH-C09', 'IZH-C10',
        ...(token.glossaryConfirmed ? ['IZH-C12'] : []),
        'IZH-C13',
      ],
      references: [
        { role: 'discipline', range: token.reference },
        { role: 'date', range: dateReference },
        { role: 'time', range: block.references.time },
        { role: 'location', range: block.references.location },
        { role: 'note', range: block.references.department },
        { role: 'note', range: block.references.assessment },
      ],
      rawSource: `${token.token}; ${block.department}; ${block.startTime}-${block.endTime}${block.location ? `; ${block.location}` : ''}`,
    };
  });

  const electiveToken = target.tokens.find((item) => item.elective);
  const electiveAlternatives = metadata.electives.map((block) => ({
    discipline: block.discipline,
    dates: [...electiveToken.dates],
    startTime: block.startTime,
    endTime: block.endTime,
    sourceSlots: block.sourceSlots,
    location: block.location,
    assessment: block.assessment,
    departmentRaw: block.department,
    references: [
      { role: 'discipline', range: electiveToken.reference },
      { role: 'date', range: dateReference },
      { role: 'time', range: block.references.time },
      { role: 'location', range: block.references.location },
      { role: 'note', range: block.references.department },
    ],
    ruleIds: ['IZH-C03', 'IZH-C04', 'IZH-C08', 'IZH-C09', 'IZH-C11'],
  }));
  const reviewRequired = [{
    warning: 'elective_choice_required',
    discipline: 'Дисциплина по выбору',
    dates: [...electiveToken.dates],
    alternatives: electiveAlternatives.length,
    references: [{ role: 'discipline', range: electiveToken.reference }, { role: 'date', range: dateReference }],
    ruleIds: ['IZH-C11'],
  }];

  const safeEventCount = series.reduce((sum, item) => sum + item.dates.length, 0);
  if (safeEventCount !== headers.dates.size - electiveToken.dates.length) {
    const error = new Error(`IZH-CYCLE medicine-5 safe coverage mismatch: ${safeEventCount}/${headers.dates.size - electiveToken.dates.length}`);
    error.code = 'IZH_CYCLE_M5_SAFE_COVERAGE_CHANGED';
    throw error;
  }

  return {
    profile: 'IZH-CYCLE',
    parserVersion: 'izhgmu-cycle-medicine5-v1',
    sourceSheet: sheet.name,
    group: targetGroup,
    sourceGroupSpan: target.label,
    period,
    series,
    electiveAlternatives,
    reviewRequired,
    deferred: [],
    warnings: [],
    stats: {
      dateColumns: headers.dates.size,
      groupRows: parsedRows.length,
      safeSeries: series.length,
      safeEventCount,
      electiveDateCount: electiveToken.dates.length,
      electiveAlternativeCount: electiveAlternatives.length,
      jointGroupCount: target.groups.length,
    },
    publishable: false,
  };
}

export async function parseIzhgmuMedicine5CycleWorkbook(buffer, { groupCode }) {
  return parseIzhgmuMedicine5CycleStructures({ structure: await readIzhgmuXlsxStructure(buffer), groupCode });
}
