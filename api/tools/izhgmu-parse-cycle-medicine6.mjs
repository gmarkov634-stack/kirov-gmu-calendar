import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseIzhgmuMedicine6CycleWorkbook,
  verifyIzhgmuMedicine6LectureGlossaryStructure,
} from '../src/adapters/izhgmu/cycle-medicine6.mjs';
import { buildIzhgmuCycleCanonicalBatch, buildIzhgmuCycleQaCandidate } from '../src/adapters/izhgmu/cycle-canonical.mjs';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function normalizeAcademicYear(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2}|\d{2})/); if (!match) throw new Error(`Invalid academic year: ${value}`);
  const start = Number(match[1]); let end = Number(match[2]); if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end !== start + 1) throw new Error(`Non-consecutive academic year: ${value}`); return `${start}/${end}`;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const groupCode = String(arg('--group', '601'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const classSources = report.files.filter((item) => item.status === 'downloaded' && item.spreadsheetKind === 'xlsx' && item.faculty === 'medicine' && Number(item.course) === 6 && item.language === 'ru' && item.term === 'spring' && item.sourceKind === 'class');
if (classSources.length !== 1) throw new Error(`Expected one medicine-6 class source; got ${classSources.length}`);
const source = classSources[0]; const classBuffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(classBuffer) !== source.sha256) throw new Error('IZH-CYCLE medicine-6 source SHA mismatch');
const parsed = await parseIzhgmuMedicine6CycleWorkbook(classBuffer, { groupCode });

if (parsed.period.start_date !== '2026-02-02' || parsed.period.end_date !== '2026-05-30') throw new Error(`Medicine-6 period changed: ${parsed.period.start_date}..${parsed.period.end_date}`);
const expectedStats = { dateColumns: 98, groupRows: 15, safeSeries: 10, safeEventCount: 86, electiveBlockCount: 2, electiveDateCount: 12, electiveAlternativeCount: 11, jointGroupCount: 2 };
for (const [key, value] of Object.entries(expectedStats)) if (parsed.stats[key] !== value) throw new Error(`Medicine-6 ${key} changed: ${parsed.stats[key]}/${value}`);
if (groupCode === '601' && parsed.sourceGroupSpan !== '601-602') throw new Error(`Medicine-6 group span changed: ${parsed.sourceGroupSpan}`);
if (parsed.reviewRequired.length !== 2 || parsed.reviewRequired.some((item) => item.warning !== 'elective_choice_required') || parsed.reviewRequired.map((item) => item.electiveSlot).sort().join(',') !== '4,5') throw new Error(`Medicine-6 blocker set changed: ${JSON.stringify(parsed.reviewRequired)}`);
if (parsed.publishable !== false) throw new Error('Medicine-6 must remain fail-closed while DВ4/DВ5 choices are unresolved');

const safeDates = new Set(parsed.series.flatMap((item) => item.dates));
const electiveDates = new Set(parsed.electiveChoices.flatMap((item) => item.dates));
for (const omitted of ['2026-02-23', '2026-03-09', '2026-05-01', '2026-05-09']) if (safeDates.has(omitted) || electiveDates.has(omitted)) throw new Error(`Medicine-6 source-omitted date leaked: ${omitted}`);
for (const date of electiveDates) if (safeDates.has(date)) throw new Error(`Medicine-6 elective date leaked into safe events: ${date}`);

const expectedSeries = new Map([
  ['Эпидемиология', { count: 11, start: '2026-02-02', end: '2026-02-13', time: '08:00-12:05' }],
  ['Фтизиатрия', { count: 13, start: '2026-02-14', end: '2026-03-02', time: '08:00-12:05' }],
  ['Основы современной хирургии', { count: 5, start: '2026-03-03', end: '2026-03-07', time: '08:00-11:50' }],
  ['Поликлиническая терапия', { count: 8, start: '2026-03-10', end: '2026-03-18', time: '08:00-11:50' }],
  ['Коммуникативные навыки', { count: 6, start: '2026-03-19', end: '2026-03-25', time: '08:00-11:35' }],
  ['Госпитальная терапия', { count: 10, start: '2026-03-26', end: '2026-04-06', time: '08:00-11:50' }],
  ['Избр. вопр. терапии', { count: 10, start: '2026-04-07', end: '2026-04-17', time: '08:00-11:35' }],
  ['Онкология', { count: 10, start: '2026-04-18', end: '2026-04-29', time: '08:00-11:45' }],
  ['Функциональная диагностика в клинике внутренних болезней', { count: 6, start: '2026-04-30', end: '2026-05-07', time: '08:00-11:50' }],
  ['Основы экстренной и неотложной помощи', { count: 7, start: '2026-05-08', end: '2026-05-16', time: '08:00-11:45' }],
]);
for (const series of parsed.series) {
  const expected = expectedSeries.get(series.discipline); if (!expected) throw new Error(`Unexpected medicine-6 safe discipline: ${series.discipline}`);
  if (series.dates.length !== expected.count || series.dates[0] !== expected.start || series.dates.at(-1) !== expected.end) throw new Error(`Medicine-6 dates changed for ${series.discipline}: ${JSON.stringify(series.dates)}`);
  if (`${series.startTime}-${series.endTime}` !== expected.time) throw new Error(`Medicine-6 time changed for ${series.discipline}: ${series.startTime}-${series.endTime}`);
  if (groupCode === '601' && !series.jointGroups.includes('602')) throw new Error(`Medicine-6 joint-group evidence missing for ${series.discipline}`);
}

const bySlot = new Map(parsed.electiveChoices.map((item) => [item.slot, item]));
for (const [slot, expected] of [[4, { count: 6, options: 6 }], [5, { count: 6, options: 5 }]]) {
  const choice = bySlot.get(slot); if (!choice || choice.dates.length !== expected.count || choice.alternatives.length !== expected.options) throw new Error(`Medicine-6 elective ${slot} structure changed`);
  if (choice.startTime !== '08:00' || choice.endTime !== '11:50') throw new Error(`Medicine-6 elective ${slot} time changed`);
  if (choice.alternatives.some((item) => item.dates.join(',') !== choice.dates.join(','))) throw new Error(`Medicine-6 elective ${slot} alternative date binding changed`);
}
if (groupCode === '601') {
  if (bySlot.get(5).dates.join(',') !== ['2026-05-18','2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23'].join(',')) throw new Error('Medicine-6 group 601 DВ5 date block changed');
  if (bySlot.get(4).dates.join(',') !== ['2026-05-25','2026-05-26','2026-05-27','2026-05-28','2026-05-29','2026-05-30'].join(',')) throw new Error('Medicine-6 group 601 DВ4 date block changed');
}

const lectureSources = report.files.filter((item) => item.status === 'downloaded' && item.spreadsheetKind === 'xlsx' && item.faculty === 'medicine' && Number(item.course) === 6 && item.language === 'ru' && item.term === 'spring' && item.sourceKind === 'lecture');
if (lectureSources.length !== 1) throw new Error(`Medicine-6 lecture companion set changed: ${lectureSources.map((item) => item.filename).join(', ')}`);
const lectureSource = lectureSources[0]; const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
if (sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`Medicine-6 lecture SHA mismatch: ${lectureSource.filename}`);
const glossaryEvidence = verifyIzhgmuMedicine6LectureGlossaryStructure(await readIzhgmuXlsxStructure(lectureBuffer));
if (glossaryEvidence.confirmed.length !== 10) throw new Error(`Medicine-6 lecture glossary coverage changed: ${glossaryEvidence.confirmed.length}/10`);

const metadata = { academicYear: normalizeAcademicYear(source.academicYear), semester: source.term, facultyCode: source.faculty, course: 6, groupCode, stream: null };
const sourceMetadata = { fileName: source.filename, fileHash: source.sha256 };
const candidate = buildIzhgmuCycleQaCandidate({ parsed, metadata, source: sourceMetadata });
if (candidate.events.length !== 86) throw new Error(`Medicine-6 QA safe event count changed: ${candidate.events.length}`);
if (candidate.events.some((event) => /Дисциплина по выбору|Актуальные вопросы онкологии|Фитотерапия|Юридическая защита|комплементар|военно-полевой|Ультразвуковая топографическая|Экстремальная медицина|лабораторной диагностики|Наркология|гематологии|Расстройства личности/i.test(event.lesson.discipline.raw))) throw new Error('Medicine-6 unresolved elective leaked into QA candidate');
const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T20:50:00.000Z' });
if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) throw new Error(`Medicine-6 safe candidate failed shared QA: ${JSON.stringify({ input: prepared.inputQa.errors, output: prepared.outputQa.errors })}`);
let productionError = null;
try { buildIzhgmuCycleCanonicalBatch({ parsed, metadata, source: sourceMetadata }); } catch (error) { productionError = error; }
if (productionError?.code !== 'IZH_CYCLE_INCOMPLETE' || productionError.blockers?.length !== 2 || productionError.blockers.some((item) => item.warning !== 'elective_choice_required')) throw new Error(`Medicine-6 production gate changed: ${productionError?.code} ${JSON.stringify(productionError?.blockers)}`);

console.log('IZHGMU_CYCLE_MEDICINE6_REAL', JSON.stringify({
  sourceFile: source.filename, sourceHash: source.sha256, group: parsed.group, sourceGroupSpan: parsed.sourceGroupSpan, period: parsed.period, stats: parsed.stats,
  safeSeries: parsed.series.map((item) => ({ discipline: item.discipline, raw: item.disciplineRaw, dates: item.dates.length, firstDate: item.dates[0], lastDate: item.dates.at(-1), time: `${item.startTime}-${item.endTime}`, department: item.department, assessment: item.assessment })),
  omittedSourceDates: ['2026-02-23','2026-03-09','2026-05-01','2026-05-09'],
  electives: parsed.electiveChoices.map((choice) => ({ slot: choice.slot, dates: choice.dates, time: `${choice.startTime}-${choice.endTime}`, alternatives: choice.alternatives.map((item) => ({ discipline: item.discipline, department: item.department, location: item.location })), blocker: 'elective_choice_required' })),
  lectureCompanion: { filename: lectureSource.filename, sha256: lectureSource.sha256, glossaryConfirmed: glossaryEvidence.confirmed.length },
  inputQa: prepared.inputQa.publishable, outputQa: prepared.outputQa.publishable, productionGate: productionError.code, productionBlockers: productionError.blockers.length,
}));
