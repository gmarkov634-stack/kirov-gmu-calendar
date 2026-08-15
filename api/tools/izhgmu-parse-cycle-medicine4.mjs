import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine4CycleWorkbook } from '../src/adapters/izhgmu/cycle-medicine4.mjs';
import {
  buildIzhgmuCycleCanonicalBatch,
  buildIzhgmuCycleQaCandidate,
} from '../src/adapters/izhgmu/cycle-canonical.mjs';
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

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const groupCode = String(arg('--group', '401'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const source = report.files.find((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 4
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'class'
));
if (!source) throw new Error('IZH-CYCLE medicine course 4 class source missing');

const buffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(buffer) !== source.sha256) throw new Error('IZH-CYCLE medicine 4 source SHA mismatch');

const parsed = await parseIzhgmuMedicine4CycleWorkbook(buffer, { groupCode });
if (parsed.period.start_date !== '2026-02-02' || parsed.period.end_date !== '2026-05-27') {
  throw new Error(`IZH-CYCLE medicine 4 period changed: ${parsed.period.start_date}..${parsed.period.end_date}`);
}
if (parsed.stats.dateColumns !== 95 || parsed.stats.groupRows !== 16 || parsed.stats.sourceSeries !== 9 || parsed.stats.eventCount !== 95) {
  throw new Error(`IZH-CYCLE medicine 4 geometry changed: ${JSON.stringify(parsed.stats)}`);
}
if (groupCode === '401' && parsed.sourceGroupSpan !== '401-402') {
  throw new Error(`IZH-CYCLE medicine 4 group span changed: ${parsed.sourceGroupSpan}`);
}

const allDates = new Set(parsed.series.flatMap((item) => item.dates));
for (const omitted of ['2026-02-23', '2026-03-09', '2026-05-01', '2026-05-09']) {
  if (allDates.has(omitted)) throw new Error(`IZH-CYCLE source-omitted date leaked into events: ${omitted}`);
}

const urology = parsed.series.find((item) => item.discipline === 'Урология');
if (!urology
  || urology.dates.length !== 3
  || urology.dates[0] !== '2026-03-18'
  || urology.dates.at(-1) !== '2026-03-20'
  || urology.startTime !== '08:00'
  || urology.endTime !== '11:10'
  || !/факультетск.*хирург/i.test(urology.department)) {
  throw new Error(`IZH-CYCLE medicine 4 Urology structural inheritance changed: ${JSON.stringify(urology)}`);
}
if (groupCode === '401' && !urology.jointGroups.includes('402')) {
  throw new Error('IZH-CYCLE medicine 4 joint-group evidence changed for group 401');
}

const pediatrics = parsed.series.find((item) => item.discipline === 'Педиатрия');
if (pediatrics?.department !== 'Дестких инфекций') {
  throw new Error(`IZH-CYCLE source department typo/evidence changed: ${pediatrics?.department}`);
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
if (candidate.events.length !== 95) throw new Error(`IZH-CYCLE QA event count changed: ${candidate.events.length}`);

const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T19:45:00.000Z' });
if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
  throw new Error(`IZH-CYCLE medicine 4 failed shared QA: ${JSON.stringify({ input: prepared.inputQa.errors, output: prepared.outputQa.errors })}`);
}

const production = buildIzhgmuCycleCanonicalBatch({ parsed, metadata, source: sourceMetadata });
if (production.events.length !== 95) throw new Error(`IZH-CYCLE production event count changed: ${production.events.length}`);

console.log('IZHGMU_CYCLE_MEDICINE4_REAL', JSON.stringify({
  sourceFile: source.filename,
  sourceHash: source.sha256,
  group: parsed.group,
  sourceGroupSpan: parsed.sourceGroupSpan,
  period: parsed.period,
  stats: parsed.stats,
  omittedSourceDates: ['2026-02-23', '2026-03-09', '2026-05-01', '2026-05-09'],
  urology: {
    dates: urology.dates,
    time: `${urology.startTime}-${urology.endTime}`,
    department: urology.department,
    jointGroups: urology.jointGroups,
  },
  pediatricsDepartmentRaw: pediatrics.department,
  inputQa: prepared.inputQa.publishable,
  outputQa: prepared.outputQa.publishable,
  productionEvents: production.events.length,
}));
