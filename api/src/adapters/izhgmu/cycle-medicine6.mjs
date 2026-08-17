import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const DAY_INDEX = new Map([
  ['пн', 1], ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6], ['вс', 7],
]);
const MONTH_INDEX = new Map([
  ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
  ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
]);

const TOKEN_DEFINITIONS = Object.freeze([
  { id: 'epidemiology', aliases: ['Эпидемиолог'], discipline: 'Эпидемиология', metadataKey: 'infectious_epidemiology', expectedDays: 11 },
  { id: 'phthisiology', aliases: ['ФтизиатриЭ'], discipline: 'Фтизиатрия', metadataKey: 'phthisiology', expectedDays: 13 },
  { id: 'modern_surgery', aliases: ['Совхр'], discipline: 'Основы современной хирургии', metadataKey: 'hospital_surgery', expectedDays: 5 },
  { id: 'outpatient_therapy', aliases: ['Поликтер'], discipline: 'Поликлиническая терапия', metadataKey: 'outpatient_therapy', expectedDays: 8 },
  { id: 'communication', aliases: ['Комнав'], discipline: 'Коммуникативные навыки', metadataKey: 'communication', expectedDays: 6 },
  { id: 'hospital_therapy', aliases: ['Госптерап'], discipline: 'Госпитальная терапия', metadataKey: 'hospital_therapy', expectedDays: 10 },
  { id: 'selected_therapy', aliases: ['Избрвоптер'], discipline: 'Избр. вопр. терапии', metadataKey: 'selected_therapy', expectedDays: 10 },
  { id: 'oncology', aliases: ['Онкология'], discipline: 'Онкология', metadataKey: 'oncology', expectedDays: 10 },
  { id: 'functional_diagnostics', aliases: ['Фундиг', 'Функиг'], discipline: 'Функциональная диагностика в клинике внутренних болезней', metadataKey: 'functional_diagnostics', expectedDays: 6 },
  { id: 'emergency_care', aliases: ['Неотпом'], discipline: 'Основы экстренной и неотложной помощи', metadataKey: 'emergency_care', expectedDays: 7 },
  { id: 'elective_4', aliases: ['Дисвб4'], discipline: 'Дисциплина по выбору 4', electiveSlot: 4, expectedDays: 6 },
  { id: 'elective_5', aliases: ['Дисвб5'], discipline: 'Дисциплина по выбору 5', electiveSlot: 5, expectedDays: 6 },
]);
const REQUIRED_IDS = new Set(TOKEN_DEFINITIONS.map((item) => item.id));
const ORDINARY_IDS = new Set(TOKEN_DEFINITIONS.filter((item) => !item.electiveSlot).map((item) => item.id));
const EXPECTED_GROUP_SPANS = Array.from({ length: 15 }, (_, index) => {
  const start = 601 + index * 2;
  return `${start}-${start + 1}`;
});

export const IZHGMU_MEDICINE6_LECTURE_GLOSSARY = Object.freeze([
  Object.freeze({ id: 'epidemiology', pattern: /Эпидемиология/i }),
  Object.freeze({ id: 'phthisiology', pattern: /Фтизиатрия/i }),
  Object.freeze({ id: 'modern_surgery', pattern: /Основы современной хирургии/i }),
  Object.freeze({ id: 'outpatient_therapy', pattern: /Поликл\.?\s*терапия/i }),
  Object.freeze({ id: 'communication', pattern: /Коммуникативные навыки/i }),
  Object.freeze({ id: 'hospital_therapy', pattern: /Госпитальн[а-яё]*\s+терапия/i }),
  Object.freeze({ id: 'selected_therapy', pattern: /Избр\.?\s*вопр\.?\s*терапии/i }),
  Object.freeze({ id: 'oncology', pattern: /Онкология/i }),
  Object.freeze({ id: 'functional_diagnostics', pattern: /Функциональная диагностика в клинике вн\.?\s*болезней/i }),
  Object.freeze({ id: 'emergency_care', pattern: /Основы экстренной и неотложной помощи/i }),
]);

function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function compact(value) { return norm(value).replace(/\s+/g, ''); }
function columnLetters(value) {
  let n = Number(value); let output = '';
  while (n > 0) { const r = (n - 1) % 26; output = String.fromCharCode(65 + r) + output; n = Math.floor((n - 1) / 26); }
  return output;
}
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function isoWeekday(iso) { const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; }
function normalizeClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : null;
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
    const error = new Error(`IZH-CYCLE medicine-6 sheet is not unique: ${candidates.length}`);
    error.code = 'IZH_CYCLE_M6_SHEET_NOT_UNIQUE'; throw error;
  }
  return candidates[0];
}
function parsePeriod(sheet) {
  for (const cell of sheet.cells) {
    const text = norm(cell.value);
    if (!/начало .*семестра/i.test(text) || !/окончание/i.test(text)) continue;
    const match = text.match(/начало .*семестра\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\s*г?\.?\s*,?\s*окончание\s*-\s*(\d{1,2})\s+([а-яё]+)\s+(20\d{2})/i);
    if (!match) continue;
    const sm = MONTH_INDEX.get(match[2].toLowerCase()); const em = MONTH_INDEX.get(match[5].toLowerCase());
    if (!sm || !em) continue;
    return {
      start_date: isoDate(Number(match[3]), sm, Number(match[1])),
      end_date: isoDate(Number(match[6]), em, Number(match[4])),
      week1_start_date: isoDate(Number(match[3]), sm, Number(match[1])),
      reference: `${sheet.name}!${cell.ref}`,
    };
  }
  const error = new Error('IZH-CYCLE medicine-6 semester period missing'); error.code = 'IZH_CYCLE_M6_PERIOD_MISSING'; throw error;
}
function dateHeaders(sheet, period) {
  const maxRow = Math.min(15, Math.max(...sheet.cells.map((cell) => cell.row)));
  let best = null;
  for (let firstRow = 1; firstRow < maxRow; firstRow += 1) {
    const secondRow = firstRow + 1; const byColumn = new Map();
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
    columns.sort((a, b) => a.col - b.col);
    if (!best || columns.length > best.columns.length) best = { rows: [firstRow, secondRow], columns };
  }
  if (!best || best.columns.length < 30) { const e = new Error('IZH-CYCLE medicine-6 date grid missing'); e.code = 'IZH_CYCLE_M6_DATE_GRID_MISSING'; throw e; }
  const firstCol = best.columns[0].col; const lastCol = best.columns.at(-1).col;
  if (best.columns.length !== lastCol - firstCol + 1) { const e = new Error('IZH-CYCLE medicine-6 date grid has internal gaps'); e.code = 'IZH_CYCLE_M6_DATE_GRID_GAP'; throw e; }
  let year = Number(period.start_date.slice(0, 4)); let month = Number(period.start_date.slice(5, 7)); let previousDay = null;
  const dates = new Map();
  for (const item of best.columns) {
    if (previousDay !== null && item.day < previousDay) { month += 1; if (month === 13) { month = 1; year += 1; } }
    const date = isoDate(year, month, item.day);
    if (isoWeekday(date) !== item.weekday) { const e = new Error(`IZH-CYCLE medicine-6 weekday mismatch at ${columnLetters(item.col)}: ${date}`); e.code = 'IZH_CYCLE_M6_WEEKDAY_MISMATCH'; throw e; }
    dates.set(item.col, date); previousDay = item.day;
  }
  if (dates.get(firstCol) !== period.start_date || dates.get(lastCol) !== period.end_date) {
    const e = new Error(`IZH-CYCLE medicine-6 source period mismatch: ${dates.get(firstCol)}..${dates.get(lastCol)}`); e.code = 'IZH_CYCLE_M6_PERIOD_MISMATCH'; throw e;
  }
  return { rows: best.rows, firstCol, lastCol, dates };
}
function groupSpan(label) {
  const values = [...String(label).matchAll(/\d{3,4}/g)].map((match) => Number(match[0]));
  if (values.length !== 2 || values[1] < values[0] || values[1] - values[0] > 20) return [];
  return Array.from({ length: values[1] - values[0] + 1 }, (_, index) => String(values[0] + index));
}
function metadataRow(sheet) {
  const rows = sheet.cells.filter((cell) => cell.col === 1 && /^кафедра$/i.test(norm(cell.value)));
  if (rows.length !== 1) { const e = new Error(`IZH-CYCLE medicine-6 metadata row count changed: ${rows.length}`); e.code = 'IZH_CYCLE_M6_METADATA_ROW_CHANGED'; throw e; }
  return rows[0].row;
}
function groupRows(sheet, headers, metaRow) {
  const rows = sheet.cells
    .filter((cell) => cell.col === 1 && cell.row > Math.max(...headers.rows) && cell.row < metaRow)
    .map((cell) => ({ row: cell.row, label: norm(cell.value), groups: groupSpan(cell.value) }))
    .filter((item) => /^\d{3}\s*[-–]\s*\d{3}$/.test(item.label));
  const labels = rows.map((item) => item.label.replace('–', '-'));
  if (labels.join('|') !== EXPECTED_GROUP_SPANS.join('|')) {
    const e = new Error(`IZH-CYCLE medicine-6 group-span set changed: ${labels.join(', ')}`); e.code = 'IZH_CYCLE_M6_GROUP_SET_CHANGED'; throw e;
  }
  return rows;
}
function matchDefinition(text, offset) {
  for (const definition of TOKEN_DEFINITIONS) {
    for (const alias of definition.aliases) if (text.startsWith(alias, offset)) return { definition, alias };
  }
  return null;
}
function parseTokenRow(sheet, row, headers) {
  const cellsByColumn = new Map(sheet.cells.filter((cell) => cell.row === row).map((cell) => [cell.col, cell]));
  const chars = [];
  for (let col = headers.firstCol; col <= headers.lastCol; col += 1) {
    const text = compact(cellsByColumn.get(col)?.value);
    for (const char of text) chars.push({ char, col });
  }
  const text = chars.map((item) => item.char).join(''); const parsed = []; let offset = 0;
  while (offset < text.length) {
    const matched = matchDefinition(text, offset);
    if (!matched) { const e = new Error(`IZH-CYCLE medicine-6 unknown token at row ${row}: ${text.slice(offset, offset + 24)}`); e.code = 'IZH_CYCLE_M6_TOKEN_UNKNOWN'; throw e; }
    const { definition, alias } = matched; const startCol = chars[offset].col; const nextOffset = offset + alias.length;
    const nextTokenCol = nextOffset < chars.length ? chars[nextOffset].col : headers.lastCol + 1; const endCol = nextTokenCol - 1;
    const dates = [];
    for (let col = startCol; col <= endCol; col += 1) {
      const date = headers.dates.get(col);
      if (!date) { const e = new Error(`IZH-CYCLE medicine-6 token date column unmapped ${columnLetters(col)}${row}`); e.code = 'IZH_CYCLE_M6_TOKEN_DATE_UNMAPPED'; throw e; }
      dates.push(date);
    }
    parsed.push({ ...definition, sourceToken: alias, startCol, endCol, dates, reference: `${sheet.name}!${columnLetters(startCol)}${row}:${columnLetters(endCol)}${row}` });
    offset = nextOffset;
  }
  const ids = parsed.map((item) => item.id);
  if (ids.length !== REQUIRED_IDS.size || new Set(ids).size !== REQUIRED_IDS.size || [...REQUIRED_IDS].some((id) => !ids.includes(id))) {
    const e = new Error(`IZH-CYCLE medicine-6 token set changed at row ${row}: ${ids.join(', ')}`); e.code = 'IZH_CYCLE_M6_TOKEN_SET_CHANGED'; throw e;
  }
  for (const item of parsed) if (item.dates.length !== item.expectedDays) {
    const e = new Error(`IZH-CYCLE medicine-6 ${item.sourceToken} duration changed at row ${row}: ${item.dates.length}/${item.expectedDays}`); e.code = 'IZH_CYCLE_M6_TOKEN_DURATION_CHANGED'; throw e;
  }
  if (parsed.reduce((sum, item) => sum + item.dates.length, 0) !== headers.dates.size) {
    const e = new Error(`IZH-CYCLE medicine-6 row ${row} does not cover source calendar`); e.code = 'IZH_CYCLE_M6_ROW_COVERAGE_CHANGED'; throw e;
  }
  const tail = parsed.slice(-2).map((item) => item.id).sort().join('|');
  if (tail !== ['elective_4', 'elective_5'].sort().join('|') || parsed.slice(0, -2).some((item) => !ORDINARY_IDS.has(item.id))) {
    const e = new Error(`IZH-CYCLE medicine-6 elective tail changed at row ${row}`); e.code = 'IZH_CYCLE_M6_ELECTIVE_POSITION_CHANGED'; throw e;
  }
  return parsed;
}
function classifyMetadata(department, control) {
  const text = norm(department); const ctl = norm(control);
  if (/госпитальн[а-яё]*\s+терап/i.test(text)) return /^экзамен/i.test(ctl) ? 'hospital_therapy' : /^зачет/i.test(ctl) ? 'functional_diagnostics' : null;
  if (/^фтизиатр/i.test(text)) return 'phthisiology';
  if (/внутренн[а-яё]*\s+болезн/i.test(text)) return 'selected_therapy';
  if (/хирургическ[а-яё]*\s+болезн.*анестезиолог/i.test(text)) return 'emergency_care';
  if (/^онколог/i.test(text)) return 'oncology';
  if (/инфекционн[а-яё]*\s+болезн.*эпидемиолог/i.test(text)) return 'infectious_epidemiology';
  if (/поликлиническ[а-яё]*\s+т[ек]рап/i.test(text)) return 'outpatient_therapy';
  if (/госпитальн[а-яё]*\s+хирург/i.test(text)) return 'hospital_surgery';
  if (/педагог.*психолог.*психосомат/i.test(text)) return 'communication';
  return null;
}
function metadataBlocks(sheet, metaRow) {
  const departmentCells = sheet.cells.filter((cell) => cell.row === metaRow && cell.col > 1 && norm(cell.value));
  if (departmentCells.length !== 10) { const e = new Error(`IZH-CYCLE medicine-6 core metadata block count changed: ${departmentCells.length}`); e.code = 'IZH_CYCLE_M6_METADATA_COUNT_CHANGED'; throw e; }
  const blocks = new Map();
  for (const deptCell of departmentCells) {
    const timeCell = sheet.cells.find((cell) => cell.row === metaRow + 1 && cell.col === deptCell.col);
    const controlCell = sheet.cells.find((cell) => cell.row === metaRow + 2 && cell.col === deptCell.col);
    const locationCell = sheet.cells.find((cell) => cell.row === metaRow + 3 && cell.col === deptCell.col);
    const key = classifyMetadata(deptCell.value, controlCell?.value);
    if (!key || blocks.has(key)) { const e = new Error(`IZH-CYCLE medicine-6 metadata binding ambiguous: ${norm(deptCell.value)} / ${norm(controlCell?.value)}`); e.code = 'IZH_CYCLE_M6_METADATA_AMBIGUOUS'; throw e; }
    const slots = clockRanges(timeCell?.value);
    if (slots.length !== 2) { const e = new Error(`IZH-CYCLE medicine-6 time-slot structure changed for ${key}: ${norm(timeCell?.value)}`); e.code = 'IZH_CYCLE_M6_TIME_SLOT_CHANGED'; throw e; }
    blocks.set(key, {
      key, department: norm(deptCell.value), timeRaw: norm(timeCell?.value), timeSlots: slots,
      startTime: slots[0].start, endTime: slots.at(-1).end, assessment: norm(controlCell?.value) || null, location: norm(locationCell?.value) || null,
      references: { department: `${sheet.name}!${deptCell.ref}`, time: timeCell ? `${sheet.name}!${timeCell.ref}` : null, assessment: controlCell ? `${sheet.name}!${controlCell.ref}` : null, location: locationCell ? `${sheet.name}!${locationCell.ref}` : null },
    });
  }
  if (blocks.size !== 10) { const e = new Error(`IZH-CYCLE medicine-6 metadata key coverage changed: ${blocks.size}`); e.code = 'IZH_CYCLE_M6_METADATA_COVERAGE_CHANGED'; throw e; }
  return blocks;
}
function electiveSections(sheet) {
  const markers = sheet.cells
    .map((cell) => ({ cell, match: norm(cell.value).match(/^ДВ\s*([45])\s*\(\s*ЗАЧЕТ\s*\)$/i) }))
    .filter((item) => item.match).map((item) => ({ slot: Number(item.match[1]), cell: item.cell })).sort((a, b) => a.cell.col - b.cell.col);
  if (markers.length !== 2 || markers.map((item) => item.slot).sort().join(',') !== '4,5' || markers[0].cell.row !== markers[1].cell.row) {
    const e = new Error('IZH-CYCLE medicine-6 elective section markers changed'); e.code = 'IZH_CYCLE_M6_ELECTIVE_MARKERS_CHANGED'; throw e;
  }
  const optionRow = markers[0].cell.row + 2;
  const maxOptionCol = Math.max(...sheet.cells.filter((cell) => cell.row === optionRow && norm(cell.value)).map((cell) => cell.col));
  const result = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]; const endCol = markers[index + 1] ? markers[index + 1].cell.col - 1 : maxOptionCol;
    const timeCell = sheet.cells.find((cell) => cell.row === marker.cell.row + 1 && cell.col === marker.cell.col); const slots = clockRanges(timeCell?.value);
    if (slots.length !== 2 || slots[0].start !== '08:00' || slots.at(-1).end !== '11:50') {
      const e = new Error(`IZH-CYCLE medicine-6 elective ${marker.slot} time changed: ${norm(timeCell?.value)}`); e.code = 'IZH_CYCLE_M6_ELECTIVE_TIME_CHANGED'; throw e;
    }
    const optionCells = sheet.cells.filter((cell) => cell.row === optionRow && cell.col >= marker.cell.col && cell.col <= endCol && norm(cell.value)).sort((a, b) => a.col - b.col);
    const alternatives = optionCells.map((cell) => {
      const departmentCell = sheet.cells.find((item) => item.row === optionRow + 1 && item.col === cell.col);
      const locationCell = sheet.cells.find((item) => item.row === optionRow + 2 && item.col === cell.col);
      return { discipline: norm(cell.value), department: norm(departmentCell?.value) || null, location: norm(locationCell?.value) || null, startTime: slots[0].start, endTime: slots.at(-1).end,
        references: [{ role: 'discipline', range: `${sheet.name}!${cell.ref}` }, ...(departmentCell ? [{ role: 'department', range: `${sheet.name}!${departmentCell.ref}` }] : []), ...(locationCell ? [{ role: 'location', range: `${sheet.name}!${locationCell.ref}` }] : [])] };
    });
    const expectedCount = marker.slot === 4 ? 6 : 5;
    if (alternatives.length !== expectedCount || new Set(alternatives.map((item) => item.discipline)).size !== expectedCount) {
      const e = new Error(`IZH-CYCLE medicine-6 elective ${marker.slot} option count changed: ${alternatives.length}/${expectedCount}`); e.code = 'IZH_CYCLE_M6_ELECTIVE_OPTIONS_CHANGED'; throw e;
    }
    result.set(marker.slot, { slot: marker.slot, startTime: slots[0].start, endTime: slots.at(-1).end, timeSlots: slots, assessment: 'Зачет', alternatives, reference: `${sheet.name}!${marker.cell.ref}` });
  }
  return result;
}
function resolveTarget(rows, parsedRows, groupCode) {
  const code = String(groupCode || '601'); const index = rows.findIndex((row) => row.groups.includes(code));
  if (index < 0) { const e = new Error(`IZH-CYCLE medicine-6 group not found: ${code}`); e.code = 'IZH_CYCLE_M6_GROUP_NOT_FOUND'; throw e; }
  return { row: rows[index], tokens: parsedRows[index], group: code };
}

export function verifyIzhgmuMedicine6LectureGlossaryStructure(structure) {
  const text = (structure?.sheets || []).flatMap((sheet) => sheet.cells.map((cell) => norm(cell.value))).filter(Boolean).join('\n');
  const missing = IZHGMU_MEDICINE6_LECTURE_GLOSSARY.filter((item) => !item.pattern.test(text)).map((item) => item.id);
  if (missing.length) { const e = new Error(`IZH medicine-6 lecture glossary evidence missing: ${missing.join(', ')}`); e.code = 'IZH_CYCLE_M6_LECTURE_GLOSSARY_MISSING'; e.missing = missing; throw e; }
  return { status: 'ok', confirmed: IZHGMU_MEDICINE6_LECTURE_GLOSSARY.map((item) => item.id) };
}

export function parseIzhgmuMedicine6CycleStructure(structure, { groupCode = '601' } = {}) {
  const sheet = cycleSheet(structure); const period = parsePeriod(sheet); const headers = dateHeaders(sheet, period); const metaRow = metadataRow(sheet);
  const rows = groupRows(sheet, headers, metaRow); const parsedRows = rows.map((row) => parseTokenRow(sheet, row.row, headers));
  const metadata = metadataBlocks(sheet, metaRow); const electives = electiveSections(sheet); const target = resolveTarget(rows, parsedRows, groupCode);
  const jointGroups = target.row.groups.filter((group) => group !== target.group); const series = [];
  for (const token of target.tokens.filter((item) => !item.electiveSlot)) {
    const block = metadata.get(token.metadataKey);
    if (!block) { const e = new Error(`IZH-CYCLE medicine-6 metadata missing for ${token.id}`); e.code = 'IZH_CYCLE_M6_METADATA_MISSING'; throw e; }
    const warnings = token.sourceToken === 'Функиг' ? ['source_token_variant_funkig'] : [];
    series.push({
      sourceRole: 'class', sourceSheet: sheet.name, group: target.group, sourceGroupSpan: target.row.label.replace('–', '-'),
      discipline: token.discipline, disciplineRaw: token.sourceToken, lessonType: { raw: 'практические занятия', code: 'practice' },
      dates: token.dates, startTime: block.startTime, endTime: block.endTime, sourceTimeSlots: block.timeSlots,
      department: block.department, assessment: block.assessment, location: block.location, jointGroups,
      status: 'ok', warning: null, warnings, ruleIds: ['IZH-C02', 'IZH-C03', 'IZH-C04', 'IZH-C08', 'IZH-C14', 'IZH-C15', 'IZH-C16'],
      references: [
        { role: 'discipline', range: token.reference }, { role: 'group_span', range: `${sheet.name}!A${target.row.row}` },
        { role: 'date', range: `${sheet.name}!${columnLetters(token.startCol)}${headers.rows[0]}:${columnLetters(token.endCol)}${headers.rows[1]}` },
        { role: 'department', range: block.references.department }, { role: 'time', range: block.references.time },
        ...(block.references.assessment ? [{ role: 'assessment', range: block.references.assessment }] : []),
        ...(block.references.location ? [{ role: 'location', range: block.references.location }] : []),
      ],
      rawSource: [token.sourceToken, block.department, block.timeRaw, block.assessment, block.location].filter(Boolean).join(' | '),
    });
  }
  const electiveChoices = target.tokens.filter((item) => item.electiveSlot).map((token) => {
    const section = electives.get(token.electiveSlot);
    return { slot: token.electiveSlot, discipline: token.discipline, disciplineRaw: token.sourceToken, dates: token.dates, startTime: section.startTime, endTime: section.endTime,
      sourceTimeSlots: section.timeSlots, assessment: section.assessment, alternatives: section.alternatives.map((item) => ({ ...item, dates: token.dates })), reference: token.reference, sectionReference: section.reference };
  }).sort((a, b) => a.slot - b.slot);
  const reviewRequired = electiveChoices.map((choice) => ({
    sourceRole: 'class', sourceSheet: sheet.name, group: target.group, discipline: choice.discipline, disciplineRaw: choice.disciplineRaw,
    dates: choice.dates, startTime: choice.startTime, endTime: choice.endTime, status: 'needs_review', warning: 'elective_choice_required', warnings: ['elective_choice_required'],
    electiveSlot: choice.slot, options: choice.alternatives.map((item) => item.discipline), ruleIds: ['IZH-C17', 'IZH-C18'],
    references: [{ role: 'discipline', range: choice.reference }, { role: 'note', range: choice.sectionReference }],
  }));
  return {
    profile: 'IZH-CYCLE', sourceProfile: 'IZH-CYCLE-MEDICINE6', sourceSheet: sheet.name, group: target.group, sourceGroupSpan: target.row.label.replace('–', '-'),
    period, series, reviewRequired, electiveChoices,
    stats: { dateColumns: headers.dates.size, groupRows: rows.length, safeSeries: series.length, safeEventCount: series.reduce((sum, item) => sum + item.dates.length, 0),
      electiveBlockCount: electiveChoices.length, electiveDateCount: electiveChoices.reduce((sum, item) => sum + item.dates.length, 0),
      electiveAlternativeCount: electiveChoices.reduce((sum, item) => sum + item.alternatives.length, 0), jointGroupCount: target.row.groups.length },
    publishable: false,
  };
}

export async function parseIzhgmuMedicine6CycleWorkbook(buffer, options = {}) {
  return parseIzhgmuMedicine6CycleStructure(await readIzhgmuXlsxStructure(buffer), options);
}
