import { parseWeeklyRWorkbook as parseLegacyWeeklyRWorkbook } from './weekly-r-parser.mjs';

const CLOCK = String.raw`(?:[01]?\d|2[0-3])[.:][0-5]\d`;
const TIME = String.raw`${CLOCK}\s*-\s*${CLOCK}`;
const TIME_BLOCK = String.raw`${TIME}(?:\s*,\s*${TIME})*`;
const DATE_TOKEN_RE = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_RANGE_RE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?!\d)/g;
const INLINE_EXTRA_RE = /\((\d+)\s+занят(?:ие|ия)\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\s*([^)]*)\)/gi;
const SHIFT_RE = new RegExp(String.raw`\(\s*с\s+(\d{1,2})\.(\d{2})\s+(${TIME_BLOCK})\s*\)`, 'i');
const TIME_BLOCK_RE = new RegExp(TIME_BLOCK, 'g');
const WEEKDAYS = new Map([['пн',1],['вт',2],['ср',3],['чт',4],['пт',5],['сб',6]]);

const SUBJECT_MAP = [
  {
    canonical: 'Патофизиология, клиническая патофизиология. Патофизиология (модуль)',
    surrogate: 'Философия',
    pattern: /патофизиология\s*,\s*клиническая\s+патофизиология\.\s*патофизиология\s*\(модуль\)/i,
  },
  {
    canonical: 'Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль)',
    surrogate: 'Биология',
    pattern: /патологическая\s+анатомия\s*,\s*клиническая\s+патологическая\s+анатомия\.\s*патологическая\s+анатомия\s*\(модуль\)/i,
  },
  { canonical: 'Общая хирургия', surrogate: 'Правоведение', pattern: /общая\s+хирургия/i },
  { canonical: 'Лучевая диагностика и терапия', surrogate: 'История России', pattern: /лучевая\s+диагностика\s+и\s+терапия/i },
  { canonical: 'Пропедевтика внутренних болезней', surrogate: 'История медицины', pattern: /пропедевтика\s+внутренних\s+болезней/i },
  {
    canonical: 'Организация сестринской помощи (дисциплина по выбору)',
    surrogate: 'Иностранный язык',
    pattern: /организация\s+сестринской\s+помощи(?:\s*\(дисциплина\s+по\s+выбору\))?/i,
  },
  {
    canonical: 'Общественное здоровье и здравоохранение, экономика здравоохранения',
    surrogate: 'Медицинская информатика',
    pattern: /о?общественное\s+здоровье\s+и\s+здравоохранение\s*,\s*экономика\s+здравоохранения/i,
  },
  {
    canonical: 'Инклюзивно ориентированная компетентность врача',
    surrogate: 'Безопасность жизнедеятельности',
    pattern: /инклюзивно\s+ориентированная\s+компетент(?:ность|ость)\s+врача/i,
  },
];

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function pad(value) { return String(value).padStart(2, '0'); }
function refFor(col, row) {
  let n = col;
  let letters = '';
  while (n) {
    n -= 1;
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return `${letters}${row}`;
}
function dateObj(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}
function formatDate(date) { return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}`; }
function isoDate(date) { return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`; }
function weekdayIso(date) { const day = date.getUTCDay(); return day === 0 ? 7 : day; }
function parseAcademicCalendarYear(sheet, options) {
  for (const cell of sheet.cells || []) {
    const match = clean(cell.value).match(/(\d{1,2})\.(\d{2})\.(20\d{2}).*?[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);
    if (match) return Number(match[3]);
  }
  const academic = String(options?.academicYear || '').match(/(20\d{2})\/(\d{2})/);
  if (academic) return Number(academic[1]) + (Number(options?.semester) === 2 ? 1 : 0);
  return new Date().getUTCFullYear();
}
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
function groupHeader(sheet) {
  const byRow = new Map();
  for (const cell of sheet.cells || []) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  let best = null;
  for (const [row, cells] of byRow) {
    const groups = cells.map((cell) => {
      const match = clean(cell.value).match(/^(?:группа|гр\.?)\s*(\d{3})$/i);
      return match ? { code: match[1], col: cell.col } : null;
    }).filter(Boolean);
    if (!best || groups.length > best.groups.length) best = { row, groups };
  }
  return best;
}
function footerHeaderRow(sheet, afterRow = 0) {
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (cell.row <= afterRow) continue;
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  for (const [row, cells] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (cells.filter((cell) => /^дисциплина$/i.test(clean(cell.value))).length >= 1 &&
        cells.some((cell) => /кафедра/i.test(clean(cell.value)))) return row;
  }
  return null;
}
function weekdaysByRow(sheet, startRow, endRow) {
  const map = new Map();
  for (const cell of (sheet.cells || []).filter((item) => item.col === 1)) {
    const weekday = WEEKDAYS.get(clean(cell.value).toLowerCase());
    if (!weekday) continue;
    const merge = (sheet.merges || []).find((item) => item.startRow === cell.row && item.startCol === 1);
    const first = merge?.startRow ?? cell.row;
    const last = merge?.endRow ?? cell.row;
    for (let row = Math.max(first, startRow); row <= Math.min(last, endRow); row += 1) map.set(row, weekday);
  }
  return map;
}
function parseHolidays(sheet, year) {
  const result = new Set();
  for (const cell of sheet.cells || []) {
    const text = clean(cell.value);
    const index = text.search(/праздничные\s+неучебные\s+дни/i);
    if (index < 0) continue;
    for (const match of text.slice(index).matchAll(DATE_TOKEN_RE)) {
      const date = dateObj(year, Number(match[2]), Number(match[1]));
      if (date) result.add(isoDate(date));
    }
  }
  return result;
}
function parseWeekRanges(sheet, year) {
  const weeks = new Map([[1, []], [2, []]]);
  for (const cell of sheet.cells || []) {
    const text = clean(cell.value);
    if (!/1\s*недел[яи]/i.test(text) || !/2\s*недел[яи]/i.test(text)) continue;
    for (const parity of [1, 2]) {
      const marker = new RegExp(`${parity}\\s*недел[яи]\\s*[-–—]?\\s*([\\s\\S]*?)(?=(?:[12]\\s*недел[яи]|Праздничные|$))`, 'i');
      const block = text.match(marker)?.[1] || '';
      for (const match of block.matchAll(DATE_RANGE_RE)) {
        const start = dateObj(year, Number(match[2]), Number(match[1]));
        const end = dateObj(year, Number(match[4]), Number(match[3]));
        if (start && end && end >= start) weeks.get(parity).push({ start, end });
      }
    }
  }
  return weeks;
}
function datesForWeekUntil(weeks, parity, weekday, until, holidays) {
  const result = [];
  for (const range of weeks.get(parity) || []) {
    for (let date = new Date(range.start); date <= range.end && date <= until; date.setUTCDate(date.getUTCDate() + 1)) {
      if (weekdayIso(date) !== weekday || holidays.has(isoDate(date))) continue;
      result.push(new Date(date));
    }
  }
  return [...new Map(result.map((date) => [isoDate(date), date])).values()].sort((a, b) => a - b);
}
function replaceSubjects(text) {
  let result = text;
  for (const subject of SUBJECT_MAP) result = result.replace(new RegExp(subject.pattern.source, 'gi'), subject.surrogate);
  return result;
}
function normalizeBrokenSeparators(text) {
  let result = text.replace(/(\d{1,2}\.\d{2})\s*--+\s*((?:[01]?\d|2[0-3])[.:][0-5]\d\s*-\s*(?:[01]?\d|2[0-3])[.:][0-5]\d)/g, '$1-$2');
  const chained = new RegExp(String.raw`(${TIME})\s*-\s*(${TIME})(?=\s+[А-ЯЁ])`, 'g');
  result = result.replace(chained, '$1, $2');
  return result;
}
function nearestSubjectToken(text, index) {
  const lower = text.toLowerCase();
  let best = null;
  for (const subject of SUBJECT_MAP) {
    const pos = lower.lastIndexOf(subject.surrogate.toLowerCase(), index);
    if (pos >= 0 && (!best || pos > best.pos)) best = { pos, token: subject.surrogate, subject };
  }
  for (const token of ['Фармакология', 'Элективные дисциплины по физической культуре и спорту']) {
    const pos = lower.lastIndexOf(token.toLowerCase(), index);
    if (pos >= 0 && (!best || pos > best.pos)) best = { pos, token, subject: null };
  }
  return best;
}
function validDateTokens(text, year) {
  const result = [];
  for (const match of text.matchAll(DATE_TOKEN_RE)) {
    const date = dateObj(year, Number(match[2]), Number(match[1]));
    if (date) result.push(date);
  }
  return [...new Map(result.map((date) => [isoDate(date), date])).values()];
}
function expandInlineExtras(text, year, failures, source) {
  const appended = [];
  const result = text.replace(INLINE_EXTRA_RE, (whole, declaredRaw, weekdayRaw, body, offset) => {
    const dates = validDateTokens(body, year);
    if (!dates.length) return whole;
    const subject = nearestSubjectToken(text, offset);
    if (!subject) {
      failures.push({ source, reason: 'inline-extra-subject-not-found', text: whole });
      return whole;
    }
    const times = [...body.matchAll(TIME_BLOCK_RE)];
    let time = times.at(-1)?.[0] || null;
    if (!time) {
      const before = text.slice(0, subject.pos);
      time = [...before.matchAll(TIME_BLOCK_RE)].at(-1)?.[0] || null;
    }
    const declared = Number(declaredRaw);
    if (declared !== dates.length) failures.push({ source, reason: 'inline-extra-count-mismatch', declared, actual: dates.length, text: whole });
    if (!time) {
      failures.push({ source, reason: 'inline-extra-time-not-found', text: whole });
      return whole;
    }
    const room = body.match(/(?<!\d)([123]-\d{3})(?!\d)/)?.[1] || '';
    appended.push(`${time} ${subject.token} ${dates.map(formatDate).join(', ')}${room ? ` ${room}` : ''}`);
    return '';
  });
  return `${result}${appended.length ? ` ${appended.join(' ')}` : ''}`.trim();
}
function expandTimeShift(text, year, failures, source) {
  const shift = text.match(SHIFT_RE);
  if (!shift) return text;
  const effective = dateObj(year, Number(shift[2]), Number(shift[1]));
  const subject = nearestSubjectToken(text, shift.index);
  if (!effective || !subject) {
    failures.push({ source, reason: 'time-shift-context-not-found', text: shift[0] });
    return text;
  }
  const segment = text.slice(subject.pos, shift.index);
  let chosen = null;
  for (const match of segment.matchAll(DATE_RANGE_RE)) {
    const start = dateObj(year, Number(match[2]), Number(match[1]));
    const end = dateObj(year, Number(match[4]), Number(match[3]));
    if (start && end && start <= effective && effective <= end) { chosen = { match, start, end }; break; }
  }
  if (!chosen) {
    failures.push({ source, reason: 'time-shift-range-not-found', text: shift[0] });
    return text;
  }
  const previous = new Date(effective);
  previous.setUTCDate(previous.getUTCDate() - 7);
  if (previous < chosen.start) {
    failures.push({ source, reason: 'time-shift-empty-initial-range', text: shift[0] });
    return text;
  }
  const absoluteStart = subject.pos + chosen.match.index;
  const absoluteEnd = absoluteStart + chosen.match[0].length;
  const initialRange = `${formatDate(chosen.start)}-${formatDate(previous)}`;
  const shiftedRange = `${formatDate(effective)}-${formatDate(chosen.end)}`;
  const withoutShift = `${text.slice(0, absoluteStart)}${initialRange}${text.slice(absoluteEnd, shift.index)}${text.slice(shift.index + shift[0].length)}`;
  return `${withoutShift} ${shift[3]} ${subject.token} ${shiftedRange}`.trim();
}
function expandWeekUntil(text, year, weekday, weeks, holidays, failures, source) {
  return text.replace(/([12])\s*недел[яи]\s+по\s+(\d{1,2})\.(\d{2})/gi, (whole, parityRaw, dayRaw, monthRaw) => {
    const until = dateObj(year, Number(monthRaw), Number(dayRaw));
    const parity = Number(parityRaw);
    if (!until || !weekday || !(weeks.get(parity) || []).length) {
      failures.push({ source, reason: 'week-parity-expansion-failed', text: whole });
      return whole;
    }
    const dates = datesForWeekUntil(weeks, parity, weekday, until, holidays);
    if (!dates.length) {
      failures.push({ source, reason: 'week-parity-produced-no-dates', text: whole });
      return whole;
    }
    return dates.map(formatDate).join(', ');
  });
}
function canonicalFooterSubject(raw) {
  const text = clean(raw);
  for (const subject of SUBJECT_MAP) if (subject.pattern.test(text)) return subject.canonical;
  if (/^фармакология$/i.test(text)) return 'Фармакология';
  if (/элективн(?:ая|ые).*физическ/i.test(text)) return 'Элективные дисциплины по физической культуре и спорту';
  return text;
}
function normalizeAssessment(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (text.includes('экзамен')) return 'экзамен';
  if (text.includes('с оценкой')) return 'зачет с оценкой';
  if (text.includes('зач')) return 'зачёт';
  return clean(value);
}
function normalizeReferenceLocation(dept, base) {
  const source = clean(base) || clean(dept);
  if (!source) return '';
  if (/центр онкологии и медицинской радиологии/i.test(source)) return 'КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23';
  if (/больница скорой медицинской помощи/i.test(source)) return 'КОГКБУЗ «Больница скорой медицинской помощи», Октябрьский проспект, 47';
  if (/ржд\s*медицина/i.test(source)) return 'Клиническая больница «РЖД-Медицина» г. Киров, Октябрьский проспект, 151';
  if (/клиника кировского гму.*щорса\s*,?\s*64/i.test(source)) return 'Клиника Кировского ГМУ, ул. Щорса, 64';
  const corpus = source.match(/([123])\s*корпус[^\d]*(?:ул\.\s*Владимирская\s*,?\s*)?(\d{3})?/i);
  if (corpus) {
    const addresses = { '1': 'ул. Владимирская, 137', '2': 'ул. Пролетарская, 38', '3': 'ул. Владимирская, 112' };
    return `${corpus[1]} корпус, ${addresses[corpus[1]]}`;
  }
  return source;
}
function parseFooterMetadata(sheet, headerRow) {
  const result = new Map();
  if (!headerRow) return result;
  const headers = (sheet.cells || []).filter((cell) => cell.row === headerRow).sort((a, b) => a.col - b.col);
  const subjectHeaders = headers.filter((cell) => /^дисциплина$/i.test(clean(cell.value)));
  const byRef = new Map((sheet.cells || []).map((cell) => [cell.ref || refFor(cell.col, cell.row), cell.value]));
  for (let index = 0; index < subjectHeaders.length; index += 1) {
    const subjectCol = subjectHeaders[index].col;
    const nextSubjectCol = subjectHeaders[index + 1]?.col ?? Number.POSITIVE_INFINITY;
    const inBlock = headers.filter((cell) => cell.col > subjectCol && cell.col < nextSubjectCol);
    const deptCol = inBlock.find((cell) => /кафедра/i.test(clean(cell.value)))?.col;
    const baseCol = inBlock.find((cell) => /база практической подготовки/i.test(clean(cell.value)))?.col;
    const assessmentCol = inBlock.find((cell) => /форма промежуточной аттестации/i.test(clean(cell.value)))?.col;
    if (!deptCol && !assessmentCol) continue;
    for (let row = headerRow + 1; row <= headerRow + 18; row += 1) {
      const raw = byRef.get(refFor(subjectCol, row));
      if (!raw) continue;
      const subject = canonicalFooterSubject(raw);
      const dept = deptCol ? clean(byRef.get(refFor(deptCol, row))) : '';
      const base = baseCol ? clean(byRef.get(refFor(baseCol, row))) : '';
      const assessment = assessmentCol ? normalizeAssessment(byRef.get(refFor(assessmentCol, row))) : null;
      result.set(subject, { subject, dept, base, assessment, location: normalizeReferenceLocation(dept, base) });
    }
  }
  return result;
}
function remapEventTitle(title, mapping) {
  const raw = String(title || '');
  const surrogate = mapping.surrogate;
  if (raw === surrogate) return mapping.canonical;
  if (raw === `ЛЕКЦ. ${surrogate.toUpperCase()}`) return `ЛЕКЦ. ${mapping.canonical.toUpperCase()}`;
  if (raw === `ЗАЧЕТ С ОЦЕНКОЙ — ${surrogate.toUpperCase()}`) return `ЗАЧЕТ С ОЦЕНКОЙ — ${mapping.canonical.toUpperCase()}`;
  return raw;
}
function mappingForEvent(event, originalByRef) {
  const original = clean(originalByRef.get(event.sourceCell) || '');
  for (const mapping of SUBJECT_MAP) {
    const surrogateMatch = String(event.title || '').toLowerCase().includes(mapping.surrogate.toLowerCase());
    if (surrogateMatch && mapping.pattern.test(original)) return mapping;
  }
  return null;
}
function baseTitle(title) {
  return String(title || '').replace(/^ЛЕКЦ\.\s+/i, '').replace(/^ЗАЧЕТ С ОЦЕНКОЙ\s+—\s+/i, '').trim();
}
function enrichSchedules(result, originalSheet, footerMeta, failures) {
  const originalByRef = new Map((originalSheet.cells || []).map((cell) => [cell.ref || refFor(cell.col, cell.row), cell.value]));
  const metaByLower = new Map([...footerMeta.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  const schedules = result.schedules.map((schedule) => ({
    ...schedule,
    events: (schedule.events || []).map((event) => {
      const mapping = mappingForEvent(event, originalByRef);
      const title = mapping ? remapEventTitle(event.title, mapping) : event.title;
      const subject = mapping?.canonical || baseTitle(title);
      const meta = metaByLower.get(subject.toLowerCase());
      return {
        ...event,
        title,
        location: event.location || meta?.location || '',
        assessment: event.assessment || meta?.assessment || null,
      };
    }),
  }));
  for (const schedule of schedules) {
    for (const event of schedule.events || []) {
      if (SUBJECT_MAP.some((mapping) => baseTitle(event.title).toLowerCase() === mapping.surrogate.toLowerCase())) {
        failures.push({ source: event.sourceRange || event.sourceCell, reason: 'surrogate-subject-leaked', title: event.title });
      }
    }
  }
  return schedules;
}

export function parseWeeklyRWorkbookReviewed(workbook, options = {}) {
  const originalSheet = workbook?.sheets?.[0];
  if (!originalSheet) return parseLegacyWeeklyRWorkbook(workbook, options);
  const header = groupHeader(originalSheet);
  if (!header?.groups?.length) return parseLegacyWeeklyRWorkbook(workbook, options);
  const footerRow = footerHeaderRow(originalSheet, header.row);
  const scheduleEndRow = options.scheduleEndRow ?? (footerRow ? footerRow - 1 : null);
  const year = parseAcademicCalendarYear(originalSheet, options);
  const weeks = parseWeekRanges(originalSheet, year);
  const holidays = parseHolidays(originalSheet, year);
  const weekdayMap = weekdaysByRow(originalSheet, header.row + 1, scheduleEndRow || Math.max(...originalSheet.cells.map((cell) => cell.row)));
  const groupCols = new Set(header.groups.map((group) => group.col));
  const failures = [];
  const normalized = cloneWorkbook(workbook);
  const sheet = normalized.sheets[0];
  for (const cell of sheet.cells || []) {
    if (cell.row <= header.row || (scheduleEndRow && cell.row > scheduleEndRow) || !groupCols.has(cell.col)) continue;
    const original = clean(cell.value);
    if (!original) continue;
    let text = normalizeBrokenSeparators(original);
    text = replaceSubjects(text);
    text = expandTimeShift(text, year, failures, cell.ref);
    text = expandWeekUntil(text, year, weekdayMap.get(cell.row), weeks, holidays, failures, cell.ref);
    text = expandInlineExtras(text, year, failures, cell.ref);
    cell.value = text;
  }
  const parsed = parseLegacyWeeklyRWorkbook(normalized, { ...options, scheduleEndRow: scheduleEndRow || options.scheduleEndRow });
  const footerMeta = parseFooterMetadata(originalSheet, footerRow);
  const schedules = enrichSchedules(parsed, originalSheet, footerMeta, failures);
  const qa = {
    ...parsed.qa,
    status: parsed.qa.status === 'PASS' && failures.length === 0 ? 'PASS' : 'REVIEW_REQUIRED',
    reviewedProfile: 'R-MED-REVIEWED',
    normalizationFailures: failures,
  };
  return { schedules, qa };
}
