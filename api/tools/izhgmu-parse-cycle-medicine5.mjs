import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine5CycleWorkbook } from '../src/adapters/izhgmu/cycle-medicine5.mjs';
import {
  buildIzhgmuCycleCanonicalBatch,
  buildIzhgmuCycleQaCandidate,
} from '../src/adapters/izhgmu/cycle-canonical.mjs';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function normalizeAcademicYear(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2}|\d{2})/);
  if (!match) throw new Error(`Invalid academic year: ${value}`);
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end !== start + 1) throw new Error(`Non-consecutive academic year: ${value}`);
  return `${start}/${end}`;
}
function cellsContain(structure, pattern) {
  return structure.sheets.some((sheet) => sheet.cells.some((cell) => pattern.test(String(cell.value || ''))));
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const groupCode = String(arg('--group', '501'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const classSources = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 5
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'class'
));
if (classSources.length !== 1) throw new Error(`Expected one medicine-5 class source; got ${classSources.length}`);
const source = classSources[0];
const classBuffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(classBuffer) !== source.sha256) throw new Error('IZH-CYCLE medicine-5 source SHA mismatch');

const parsed = await parseIzhgmuMedicine5CycleWorkbook(classBuffer, { groupCode });
if (parsed.period.start_date !== '2026-02-16' || parsed.period.end_date !== '2026-06-20') {
  throw new Error(`IZH-CYCLE medicine-5 period changed: ${parsed.period.start_date}..${parsed.period.end_date}`);
}
const expectedStats = {
  dateColumns: 103,
  groupRows: 14,
  safeSeries: 8,
  safeEventCount: 96,
  electiveDateCount: 7,
  electiveAlternativeCount: 6,
  jointGroupCount: 2,
};
for (const [key, value] of Object.entries(expectedStats)) {
  if (parsed.stats[key] !== value) throw new Error(`IZH-CYCLE medicine-5 ${key} changed: ${parsed.stats[key]}/${value}`);
}
if (groupCode === '501' && parsed.sourceGroupSpan !== '501-502') {
  throw new Error(`IZH-CYCLE medicine-5 group span changed: ${parsed.sourceGroupSpan}`);
}
if (parsed.reviewRequired.length !== 1 || parsed.reviewRequired[0].warning !== 'elective_choice_required') {
  throw new Error(`IZH-CYCLE medicine-5 blocker set changed: ${JSON.stringify(parsed.reviewRequired)}`);
}
if (parsed.publishable !== false) throw new Error('IZH-CYCLE medicine-5 must remain fail-closed while elective is unresolved');

const safeDates = new Set(parsed.series.flatMap((item) => item.dates));
const electiveDates = parsed.electiveAlternatives[0]?.dates || [];
for (const alternative of parsed.electiveAlternatives) {
  if (alternative.dates.join(',') !== electiveDates.join(',')) {
    throw new Error(`IZH-CYCLE medicine-5 elective alternatives do not share one source date block`);
  }
  if (alternative.startTime !== '08:00' || alternative.endTime !== '11:45') {
    throw new Error(`IZH-CYCLE medicine-5 elective time changed for ${alternative.discipline}`);
  }
}
const expectedElectiveDates = ['2026-06-13', '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20'];
if (electiveDates.join(',') !== expectedElectiveDates.join(',')) {
  throw new Error(`IZH-CYCLE medicine-5 elective dates changed: ${electiveDates.join(',')}`);
}
for (const date of electiveDates) {
  if (safeDates.has(date)) throw new Error(`IZH-CYCLE medicine-5 elective date leaked into safe class events: ${date}`);
}
for (const omitted of ['2026-02-23', '2026-03-09', '2026-05-01', '2026-05-09', '2026-06-12']) {
  if (safeDates.has(omitted) || electiveDates.includes(omitted)) {
    throw new Error(`IZH-CYCLE medicine-5 source-omitted date leaked into events: ${omitted}`);
  }
}

const expectedSeries = new Map([
  ['Госпитальная хирургия', { count: 11, start: '2026-02-16', end: '2026-02-28', time: '08:00-11:35' }],
  ['Акушерство', { count: 14, start: '2026-03-02', end: '2026-03-18', time: '08:00-11:20' }],
  ['Инфекционные болезни', { count: 16, start: '2026-03-19', end: '2026-04-06', time: '08:00-11:20' }],
  ['Травматология и ортопедия', { count: 13, start: '2026-04-07', end: '2026-04-21', time: '08:00-11:10' }],
  ['Госпитальная терапия', { count: 13, start: '2026-04-22', end: '2026-05-07', time: '08:00-11:10' }],
  ['Поликлиническая терапия', { count: 13, start: '2026-05-08', end: '2026-05-23', time: '08:00-11:10' }],
  ['Избр. вопр. терапии', { count: 8, start: '2026-05-25', end: '2026-06-02', time: '08:00-11:25' }],
  ['Мед-прав. основы', { count: 8, start: '2026-06-03', end: '2026-06-11', time: '08:00-11:25' }],
]);
for (const series of parsed.series) {
  const expected = expectedSeries.get(series.discipline);
  if (!expected) throw new Error(`Unexpected medicine-5 safe discipline: ${series.discipline}`);
  if (series.dates.length !== expected.count || series.dates[0] !== expected.start || series.dates.at(-1) !== expected.end) {
    throw new Error(`Medicine-5 dates changed for ${series.discipline}: ${JSON.stringify(series.dates)}`);
  }
  if (`${series.startTime}-${series.endTime}` !== expected.time) {
    throw new Error(`Medicine-5 time changed for ${series.discipline}: ${series.startTime}-${series.endTime}`);
  }
  if (groupCode === '501' && !series.jointGroups.includes('502')) {
    throw new Error(`Medicine-5 joint-group evidence missing for ${series.discipline}`);
  }
}

const lectureSources = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 5
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'lecture'
)).sort((left, right) => Number(left.stream || 0) - Number(right.stream || 0));
if (lectureSources.length !== 2 || lectureSources.map((item) => Number(item.stream)).join(',') !== '1,2') {
  throw new Error(`Medicine-5 lecture companion set changed: ${lectureSources.map((item) => item.filename).join(', ')}`);
}
const lectureStructures = [];
for (const lecture of lectureSources) {
  const buffer = await fs.readFile(path.join(inputDir, lecture.filename));
  if (sha256(buffer) !== lecture.sha256) throw new Error(`Medicine-5 lecture SHA mismatch: ${lecture.filename}`);
  lectureStructures.push(await readIzhgmuXlsxStructure(buffer));
}
for (const [pattern, label] of [
  [/Избр\.\s*вопр\.\s*терапии/i, 'Избр.вопр.терапии'],
  [/Мед-прав\.\s*основы/i, 'Мед-прав.основы'],
]) {
  if (!lectureStructures.some((structure) => cellsContain(structure, pattern))) {
    throw new Error(`Medicine-5 lecture glossary evidence missing: ${label}`);
  }
}
const electiveNames = parsed.electiveAlternatives.map((item) => item.discipline).sort();
for (const name of electiveNames) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!lectureStructures.some((structure) => cellsContain(structure, new RegExp(escaped, 'i')))) {
    throw new Error(`Medicine-5 elective companion evidence missing: ${name}`);
  }
}

const metadata = {
  academicYear: normalizeAcademicYear(source.academicYear),
  semester: source.term,
  facultyCode: source.faculty,
  course: Number(source.course),
  groupCode,
  stream: null,
};
const sourceMetadata = { fileName: source.filename, fileHash: source.sha256 };
const candidate = buildIzhgmuCycleQaCandidate({ parsed, metadata, source: sourceMetadata });
if (candidate.events.length !== 96) throw new Error(`IZH-CYCLE medicine-5 QA safe event count changed: ${candidate.events.length}`);
if (candidate.events.some((event) => /Дисциплина по выбору|Фитотерап|комплементар|оториноларинг|невролог|Клинические рекомендации|регенератив/i.test(event.lesson.discipline.raw))) {
  throw new Error('IZH-CYCLE medicine-5 unresolved elective leaked into QA candidate');
}
const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T20:15:00.000Z' });
if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
  throw new Error(`IZH-CYCLE medicine-5 safe candidate failed shared QA: ${JSON.stringify({ input: prepared.inputQa.errors, output: prepared.outputQa.errors })}`);
}
let productionError = null;
try {
  buildIzhgmuCycleCanonicalBatch({ parsed, metadata, source: sourceMetadata });
} catch (error) {
  productionError = error;
}
if (productionError?.code !== 'IZH_CYCLE_INCOMPLETE' || productionError.blockers?.length !== 1 || productionError.blockers[0]?.warning !== 'elective_choice_required') {
  throw new Error(`IZH-CYCLE medicine-5 production gate changed: ${productionError?.code} ${JSON.stringify(productionError?.blockers)}`);
}

console.log('IZHGMU_CYCLE_MEDICINE5_REAL', JSON.stringify({
  sourceFile: source.filename,
  sourceHash: source.sha256,
  group: parsed.group,
  sourceGroupSpan: parsed.sourceGroupSpan,
  period: parsed.period,
  stats: parsed.stats,
  safeSeries: parsed.series.map((item) => ({
    discipline: item.discipline,
    dates: item.dates.length,
    firstDate: item.dates[0],
    lastDate: item.dates.at(-1),
    time: `${item.startTime}-${item.endTime}`,
    department: item.department,
  })),
  omittedSourceDates: ['2026-02-23', '2026-03-09', '2026-05-01', '2026-05-09', '2026-06-12'],
  elective: {
    dates: electiveDates,
    alternatives: parsed.electiveAlternatives.map((item) => ({ discipline: item.discipline, time: `${item.startTime}-${item.endTime}`, location: item.location })),
    blocker: parsed.reviewRequired[0].warning,
  },
  lectureCompanions: lectureSources.map((item) => ({ filename: item.filename, stream: item.stream, sha256: item.sha256 })),
  inputQa: prepared.inputQa.publishable,
  outputQa: prepared.outputQa.publishable,
  productionGate: productionError.code,
  productionBlockers: productionError.blockers.length,
}));
