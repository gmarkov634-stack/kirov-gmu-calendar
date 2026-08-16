import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuWeeklyPair } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLecturePair } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import {
  buildIzhgmuWeeklyLectureCanonicalBatch,
  buildIzhgmuWeeklyLectureQaCandidate,
  izhgmuWeeklyLectureBlockers,
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
const lectureSource = source('lecture');
if (!classSource || !lectureSource) {
  throw new Error(`IZH real source pair not found for ${faculty}/${course}/${stream}/${language}/${term}`);
}

const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
if (sha256(classBuffer) !== classSource.sha256) throw new Error('IZH class SHA mismatch');
if (sha256(lectureBuffer) !== lectureSource.sha256) throw new Error('IZH lecture SHA mismatch');

const weekly = await parseIzhgmuWeeklyPair({ classBuffer, companionBuffer: lectureBuffer, groupCode });
const lecture = await parseIzhgmuLecturePair({ classBuffer, lectureBuffer, weeklyParsed: weekly });

if (lecture.stats.lectureRows !== 24) throw new Error(`IZH-LECTURE row count changed: ${lecture.stats.lectureRows}`);
if (lecture.stats.exactOccurrences !== 165) throw new Error(`IZH-LECTURE exact occurrence count changed: ${lecture.stats.exactOccurrences}`);
if (lecture.stats.safeOccurrences !== 109) throw new Error(`IZH-LECTURE safe occurrence count changed: ${lecture.stats.safeOccurrences}`);
if (lecture.stats.electiveOccurrences !== 56) throw new Error(`IZH-LECTURE elective occurrence count changed: ${lecture.stats.electiveOccurrences}`);
if (lecture.reviewRequired.length !== 0) {
  throw new Error(`IZH-LECTURE unexpected structural review blockers: ${JSON.stringify(lecture.reviewRequired.slice(0, 3))}`);
}
if (lecture.classCoverage.totalWideBlocks !== 14) {
  throw new Error(`IZH class-wide coverage changed: ${lecture.classCoverage.totalWideBlocks}`);
}
if (lecture.classCoverage.resolvedByLecture.length !== 11
    || lecture.classCoverage.choiceRequired.length !== 3
    || lecture.classCoverage.unmapped.length !== 0) {
  throw new Error('IZH class-wide companion coverage no longer matches reviewed source');
}
const recoveredFridayHistology = lecture.classCoverage.blocks.find((item) => item.ref === 'C26');
if (!recoveredFridayHistology?.dayRecoveredFromTimeSlot || recoveredFridayHistology.weekday !== 5) {
  throw new Error('IZH Friday Histology day recovery changed');
}

for (const [discipline, declaredCount] of [['Биоэтика', 7], ['Химия', 3], ['Гистология', 9]]) {
  const holder = lecture.series.find((item) => item.discipline === discipline && item.declaredCount === declaredCount);
  if (!holder || holder.declaredCountScope !== 'discipline_total') {
    throw new Error(`IZH-LECTURE aggregate count evidence changed for ${discipline}`);
  }
}
if (lecture.choiceRequired?.options?.length !== 8) {
  throw new Error(`IZH elective choice options changed: ${lecture.choiceRequired?.options?.length}`);
}

const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
if (combined.reviewRequired.length !== 0) {
  throw new Error(`IZH combined unexpected content blocker: ${JSON.stringify(combined.reviewRequired.slice(0, 3))}`);
}
if (combined.unresolvedChoices.length !== 1 || combined.deferred.length !== 0 || combined.publishable) {
  throw new Error('IZH combined fail-closed state changed');
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
  companionFileName: lectureSource.filename,
  companionFileHash: lectureSource.sha256,
};

const candidate = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source: sourceMetadata });
if (candidate.events.length !== 375) {
  throw new Error(`IZH combined safe event count changed: ${candidate.events.length}`);
}
const curatorEvents = candidate.events.filter((event) => event.lesson.discipline.normalized === 'Кураторский час');
if (curatorEvents.length !== 19
    || curatorEvents.some((event) => event.timing.start_time !== '16:30' || event.timing.end_time !== '17:30')) {
  throw new Error(`IZH curator-hour materialization changed: ${JSON.stringify(curatorEvents.slice(0, 3))}`);
}
const prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T19:30:00.000Z' });
if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
  throw new Error('IZH combined safe candidate failed shared QA');
}
const surgical = candidate.events.find((event) => (
  event.timing.date === '2026-02-16'
  && event.timing.start_time === '08:30'
  && event.lesson.discipline.normalized === 'Хирургический уход'
));
if (!surgical || surgical.source.file_name !== lectureSource.filename
    || surgical.lesson.locations[0]?.raw !== '1 ауд.'
    || surgical.lesson.type.code !== 'lecture') {
  throw new Error('IZH exact-date lecture canonical evidence changed');
}
if (!candidate.events.some((event) => event.timing.date === '2026-05-11'
  && event.lesson.discipline.normalized === 'Биоэтика')) {
  throw new Error('IZH exact official 2026-05-11 lecture was lost');
}
if (candidate.events.some((event) => event.lesson.discipline.normalized === 'Культурология')) {
  throw new Error('IZH unresolved elective leaked into QA candidate');
}

let productionGate = null;
try {
  buildIzhgmuWeeklyLectureCanonicalBatch({ parsed: combined, metadata, source: sourceMetadata });
} catch (error) {
  productionGate = error;
}
if (productionGate?.code !== 'IZH_WEEKLY_LECTURE_INCOMPLETE') {
  throw new Error('IZH combined production gate did not fail closed');
}
const blockers = izhgmuWeeklyLectureBlockers(combined);
if (blockers.length !== 1
    || blockers[0].warning !== 'elective_choice_required') {
  throw new Error(`IZH combined blockers changed: ${JSON.stringify(blockers)}`);
}

console.log('IZHGMU_WEEKLY_LECTURE_REAL', JSON.stringify({
  group: combined.group,
  sourceFiles: [classSource.filename, lectureSource.filename],
  weeklySourceSeries: weekly.series.length,
  lectureRows: lecture.stats.lectureRows,
  lectureExactOccurrences: lecture.stats.exactOccurrences,
  lectureSafeOccurrences: lecture.stats.safeOccurrences,
  electiveOccurrencesDeferred: lecture.stats.electiveOccurrences,
  classWideCoverage: {
    total: lecture.classCoverage.totalWideBlocks,
    resolvedByLecture: lecture.classCoverage.resolvedByLecture.length,
    choiceRequired: lecture.classCoverage.choiceRequired.length,
    unmapped: lecture.classCoverage.unmapped.length,
  },
  combinedSafeEvents: candidate.events.length,
  curatorEvents: curatorEvents.length,
  blockers: blockers.map((item) => item.warning),
  inputQa: prepared.inputQa.publishable,
  outputQa: prepared.outputQa.publishable,
  productionGate: productionGate.code,
}));
