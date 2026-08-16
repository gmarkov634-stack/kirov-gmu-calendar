import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuWeeklyPair } from '../src/adapters/izhgmu/weekly-parser.mjs';
import {
  buildIzhgmuWeeklyCanonicalBatch,
  buildIzhgmuWeeklyQaCandidate,
  izhgmuWeeklyBlockers,
} from '../src/adapters/izhgmu/canonical.mjs';
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
const faculty = arg('--faculty', 'medicine');
const course = Number(arg('--course', '1'));
const stream = arg('--stream', '1');
const groupCode = arg('--group', '109');
const language = arg('--language', 'ru');
const term = arg('--term', 'spring');

const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
function source(kind) {
  return report.files.find((item) => (
    item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === faculty
    && Number(item.course) === course
    && String(item.stream ?? '') === String(stream ?? '')
    && item.language === language
    && item.term === term
    && item.sourceKind === kind
  ));
}

const classSource = source('class');
const companionSource = source('lecture');
if (!classSource || !companionSource) {
  throw new Error(`IZH-WEEKLY real source pair not found for ${faculty}/${course}/${stream}/${language}/${term}`);
}

const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
const companionBuffer = await fs.readFile(path.join(inputDir, companionSource.filename));
if (sha256(classBuffer) !== classSource.sha256) throw new Error('IZH-WEEKLY class SHA mismatch');
if (sha256(companionBuffer) !== companionSource.sha256) throw new Error('IZH-WEEKLY companion SHA mismatch');

const parsed = await parseIzhgmuWeeklyPair({ classBuffer, companionBuffer, groupCode });
if (parsed.period.start_date !== '2026-02-09' || parsed.period.end_date !== '2026-06-20') {
  throw new Error(`IZH-WEEKLY unexpected real period ${parsed.period.start_date}..${parsed.period.end_date}`);
}
if (parsed.parity.odd !== 'below_line' || parsed.parity.even !== 'above_line' || parsed.parity.evidenceCount < 2) {
  throw new Error('IZH-WEEKLY real parity evidence changed');
}
if (!parsed.deferred.length) throw new Error('IZH-WEEKLY expected stream-wide companion-owned rows');
const curatorSeries = parsed.series.find((item) => (
  item.discipline === 'Кураторский час'
  && item.startTime === '16:30'
));
if (
  !curatorSeries
  || curatorSeries.endTime !== '17:30'
  || curatorSeries.status !== 'ok'
  || !curatorSeries.ruleIds?.includes('IZH-W11')
) {
  throw new Error('IZH-WEEKLY curator-hour rule IZH-W11 no longer matches the reviewed real source');
}
if (parsed.publishable) throw new Error('IZH-WEEKLY real group must remain fail-closed before companion integration');

const parityCellSeries = parsed.series.filter((item) => item.references?.[0]?.range === 'расписание!K10');
const chemistry = parityCellSeries.find((item) => item.discipline === 'Химия' && item.parity === 'above_line');
const physics = parityCellSeries.find((item) => item.discipline === 'Физика' && item.parity === 'below_line');
if (!chemistry?.dates.includes('2026-05-11') || !physics?.dates.includes('2026-02-09')) {
  throw new Error('IZH-WEEKLY rich-text parity split no longer matches the reviewed real source');
}

const metadata = {
  academicYear: normalizeAcademicYear(classSource.academicYear),
  semester: term,
  facultyCode: faculty,
  course,
  groupCode,
  stream,
};
const sourceMetadata = {
  classFileName: classSource.filename,
  classFileHash: classSource.sha256,
  companionFileName: companionSource.filename,
  companionFileHash: companionSource.sha256,
};

const candidate = buildIzhgmuWeeklyQaCandidate({ parsed, metadata, source: sourceMetadata });
const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T18:30:00.000Z' });
if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
  throw new Error('IZH-WEEKLY safe candidate failed shared QA');
}

let productionGate = null;
try {
  buildIzhgmuWeeklyCanonicalBatch({ parsed, metadata, source: sourceMetadata });
} catch (error) {
  productionGate = error;
}
if (productionGate?.code !== 'IZH_WEEKLY_INCOMPLETE') {
  throw new Error('IZH-WEEKLY production gate did not fail closed');
}

console.log('IZHGMU_WEEKLY_REAL', JSON.stringify({
  profile: parsed.profile,
  group: parsed.group,
  sourceFiles: [classSource.filename, companionSource.filename],
  period: parsed.period,
  parity: { odd: parsed.parity.odd, even: parsed.parity.even, evidenceCount: parsed.parity.evidenceCount },
  sourceSeries: parsed.series.length,
  resolvedCandidateEvents: candidate.events.length,
  reviewRequired: parsed.reviewRequired.length,
  deferred: parsed.deferred.length,
  blockers: izhgmuWeeklyBlockers(parsed).length,
  inputQa: prepared.inputQa.publishable,
  outputQa: prepared.outputQa.publishable,
  productionGate: productionGate.code,
}));
