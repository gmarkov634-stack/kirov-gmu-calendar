import { readIzhgmuXlsxStructure } from './xlsx-reader.mjs';

const WEEKDAYS = new Map([
  ['пн', 1], ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6], ['вс', 7],
]);
const MONTHS = new Map([
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['ма', 5], ['июн', 6],
  ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10], ['ноябр', 11], ['декабр', 12],
]);

function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function compact(value) { return norm(value).replace(/\s+/g, '').toLowerCase().replace(/ё/g, 'е'); }
function colLetters(value) {
  let n = Number(value); let out = '';
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function isoWeekday(iso) { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }
function parseMonthWord(value) {
  const text = norm(value).toLowerCase();
  for (const [prefix, month] of MONTHS) if (text.startsWith(prefix)) return month;
  return null;
}
function cellAt(sheet, row, col) { return sheet.cells.find((cell) => cell.row === row && cell.col === col) || null; }
function styleAt(sheet, row, col) { return sheet.styledCells?.find((cell) => cell.row === row && cell.col === col)?.styleId ?? null; }
function fillMap(structure) { return new Map((structure.styles || []).map((style) => [style.styleId, style.fillId])); }
function groupRows(sheet) {
  return sheet.cells.filter((cell) => cell.col === 1 && /^\d{3}(?:-\d{3})?$/.test(norm(cell.value)))
    .map((cell) => ({ row: cell.row, groupSpan: norm(cell.value), ref: cell.ref }))
    .sort((a, b) => a.row - b.row);
}
function parsePeriod(sheet, firstGroupRow) {
  const text = sheet.cells.filter((cell) => cell.row < firstGroupRow).map((cell) => norm(cell.value)).join(' ');
  const match = text.match(/Начало[^-–]*[-–]\s*(\d{1,2})\s+([А-Яа-яЁё]+)\s+(20\d{2})[^О]*окончани[^-–]*[-–]\s*(\d{1,2})\s+([А-Яа-яЁё]+)\s+(20\d{2})/i);
  if (!match) {
    const error = new Error('IZH-CYCLE semester boundary missing');
    error.code = 'IZH_CYCLE_PERIOD_MISSING';
    throw error;
  }
  const startMonth = parseMonthWord(match[2]);
  const endMonth = parseMonthWord(match[5]);
  if (!startMonth || !endMonth) {
    const error = new Error('IZH-CYCLE month name is unknown'); error.code = 'IZH_CYCLE_MONTH_UNKNOWN'; throw error;
  }
  return {
    start_date: isoDate(Number(match[3]), startMonth, Number(match[1])),
    end_date: isoDate(Number(match[6]), endMonth, Number(match[4])),
    startYear: Number(match[3]), startMonth,
  };
}
function calendarColumns(sheet, firstGroupRow, period) {
  const rowA = firstGroupRow - 2;
  const rowB = firstGroupRow - 1;
  const candidateCols = [...new Set([
    ...sheet.cells.filter((cell) => cell.row === rowA).map((cell) => cell.col),
    ...sheet.cells.filter((cell) => cell.row === rowB).map((cell) => cell.col),
  ])].filter((col) => col > 1).sort((a, b) => a - b);
  const output = [];
  let year = period.startYear;
  let month = period.startMonth;
  let previousDay = null;
  for (const col of candidateCols) {
    const values = [cellAt(sheet, rowA, col)?.value, cellAt(sheet, rowB, col)?.value].map(norm).filter(Boolean);
    const dayText = values.find((value) => /^\d{1,2}$/.test(value));
    const weekdayText = values.find((value) => WEEKDAYS.has(value.toLowerCase()));
    if (!dayText || !weekdayText) continue;
    const day = Number(dayText);
    if (previousDay != null && day < previousDay - 10) {
      month += 1;
      if (month === 13) { month = 1; year += 1; }
    }
    const date = isoDate(year, month, day);
    const expectedWeekday = WEEKDAYS.get(weekdayText.toLowerCase());
    if (date < period.start_date || date > period.end_date || isoWeekday(date) !== expectedWeekday) {
      const error = new Error(`IZH-CYCLE calendar header mismatch at ${colLetters(col)}: ${date}/${weekdayText}`);
      error.code = 'IZH_CYCLE_CALENDAR_MISMATCH';
      error.column = col;
      throw error;
    }
    output.push({ col, date, weekday: expectedWeekday, headerRefs: [`${colLetters(col)}${rowA}`, `${colLetters(col)}${rowB}`] });
    previousDay = day;
  }
  if (output.length < 10) {
    const error = new Error('IZH-CYCLE calendar grid too small'); error.code = 'IZH_CYCLE_CALENDAR_TOO_SMALL'; throw error;
  }
  return output;
}
function metadataRows(sheet) {
  const labels = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 1)) {
    const text = norm(cell.value).toLowerCase();
    if (text === 'кафедра') labels.set('department', cell.row);
    else if (text === 'время') labels.set('time', cell.row);
    else if (text.includes('форма контроля')) labels.set('control', cell.row);
    else if (text.includes('база практической')) labels.set('location', cell.row);
  }
  return labels;
}
function metadataBlocks(structure, sheet) {
  const rows = metadataRows(sheet);
  const departmentRow = rows.get('department');
  if (!departmentRow) return [];
  const fills = fillMap(structure);
  const merges = sheet.merges.filter((merge) => merge.startRow === departmentRow && merge.endRow === departmentRow && merge.startCol > 1);
  return merges.map((merge, index) => {
    const department = cellAt(sheet, departmentRow, merge.startCol);
    const styleId = styleAt(sheet, departmentRow, merge.startCol);
    const valueAt = (key) => rows.get(key) ? norm(cellAt(sheet, rows.get(key), merge.startCol)?.value) || null : null;
    return {
      index: index + 1,
      startCol: merge.startCol,
      endCol: merge.endCol,
      range: merge.ref,
      department: norm(department?.value) || null,
      timeRaw: valueAt('time'),
      controlRaw: valueAt('control'),
      locationRaw: valueAt('location'),
      styleId,
      fillId: styleId == null ? null : fills.get(styleId) ?? null,
      references: {
        department: department ? `${sheet.name}!${department.ref}` : null,
        time: rows.get('time') ? `${sheet.name}!${colLetters(merge.startCol)}${rows.get('time')}` : null,
        control: rows.get('control') ? `${sheet.name}!${colLetters(merge.startCol)}${rows.get('control')}` : null,
        location: rows.get('location') ? `${sheet.name}!${colLetters(merge.startCol)}${rows.get('location')}` : null,
      },
    };
  });
}
function cycleRuns(structure, sheet, groupRow, dates) {
  const fills = fillMap(structure);
  const byCol = new Map(dates.map((item) => [item.col, item]));
  const minCol = dates[0].col;
  const maxCol = dates.at(-1).col;
  const fillAt = (col) => {
    const styleId = styleAt(sheet, groupRow.row, col);
    return styleId == null ? null : fills.get(styleId) ?? null;
  };
  const runs = [];
  let start = minCol;
  let current = fillAt(start);
  for (let col = minCol + 1; col <= maxCol + 1; col += 1) {
    const next = col <= maxCol ? fillAt(col) : Symbol('end');
    if (next !== current) {
      const end = col - 1;
      const cells = sheet.cells.filter((cell) => cell.row === groupRow.row && cell.col >= start && cell.col <= end);
      const raw = cells.map((cell) => norm(cell.value)).join('');
      const runDates = [];
      for (let c = start; c <= end; c += 1) if (byCol.has(c)) runDates.push(byCol.get(c));
      if (current != null && raw && runDates.length) runs.push({ startCol: start, endCol: end, fillId: current, rawDiscipline: raw, dates: runDates });
      start = col; current = next;
    }
  }
  return runs;
}

export function parseIzhgmuCycleStructure(structure) {
  const sheet = structure?.sheets?.find((candidate) => groupRows(candidate).length >= 2 && metadataRows(candidate).has('department'));
  if (!sheet) {
    const error = new Error('IZH-CYCLE source sheet missing'); error.code = 'IZH_CYCLE_SHEET_MISSING'; throw error;
  }
  const groups = groupRows(sheet);
  const period = parsePeriod(sheet, groups[0].row);
  const dates = calendarColumns(sheet, groups[0].row, period);
  const metadata = metadataBlocks(structure, sheet);
  const series = [];
  for (const group of groups) {
    for (const run of cycleRuns(structure, sheet, group, dates)) {
      const matches = metadata.filter((block) => block.fillId === run.fillId);
      const metadataBlock = matches.length === 1 ? matches[0] : null;
      const status = metadataBlock ? 'ok' : 'needs_review';
      series.push({
        groupSpan: group.groupSpan,
        sourceSheet: sheet.name,
        disciplineRaw: run.rawDiscipline,
        disciplineCompact: compact(run.rawDiscipline),
        fillId: run.fillId,
        startCol: run.startCol,
        endCol: run.endCol,
        dates: run.dates.map((item) => item.date),
        status,
        warning: metadataBlock ? null : matches.length ? 'cycle_metadata_fill_ambiguous' : 'cycle_metadata_fill_unmatched',
        warnings: metadataBlock ? [] : [matches.length ? 'cycle_metadata_fill_ambiguous' : 'cycle_metadata_fill_unmatched'],
        ruleIds: ['IZH-CY01', 'IZH-CY02', 'IZH-CY03', 'IZH-CY04'],
        metadataBlock,
        references: [
          { role: 'group_span', range: `${sheet.name}!${group.ref}` },
          { role: 'cycle_span', range: `${sheet.name}!${colLetters(run.startCol)}${group.row}:${colLetters(run.endCol)}${group.row}` },
          ...run.dates.flatMap((item) => item.headerRefs.map((ref) => ({ role: 'date', range: `${sheet.name}!${ref}` }))),
        ],
      });
    }
  }
  const reviewRequired = series.filter((item) => item.status === 'needs_review');
  return {
    profile: 'IZH-CYCLE', sourceSheet: sheet.name, period,
    groupSpans: groups.map((group) => group.groupSpan),
    dateColumns: dates,
    metadataBlocks: metadata,
    series, reviewRequired,
    stats: {
      groupSpanCount: groups.length,
      calendarDateCount: dates.length,
      metadataBlockCount: metadata.length,
      seriesCount: series.length,
      matchedSeriesCount: series.length - reviewRequired.length,
      reviewSeriesCount: reviewRequired.length,
    },
    publishable: reviewRequired.length === 0,
  };
}

export async function parseIzhgmuCycleWorkbook(buffer) {
  return parseIzhgmuCycleStructure(await readIzhgmuXlsxStructure(buffer));
}
