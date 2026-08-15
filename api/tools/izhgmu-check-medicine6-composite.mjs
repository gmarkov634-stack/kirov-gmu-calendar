#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine6CycleWorkbook } from '../src/adapters/izhgmu/cycle-medicine6.mjs';
import {
  parseIzhgmuMedicine6LectureWorkbook,
  IZHGMU_MEDICINE6_EXPECTED_GROUPS,
} from '../src/adapters/izhgmu/lecture-medicine6.mjs';
import { verifyIzhgmuMedicine6PostsemesterReview } from '../src/adapters/izhgmu/postsemester-reviewed.mjs';
import {
  buildIzhgmuMedicine6CompositeCandidate,
  buildIzhgmuMedicine6CompositeCanonicalBatch,
} from '../src/adapters/izhgmu/medicine6-composite.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = String(selector(item));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function findFile(root, filename) {
  const candidates = [path.join(root, filename), path.join(root, 'postsemester', filename)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`IzhGMU composite source file not found: ${filename}`);
}

const currentDir = path.resolve(arg('--current-dir', '/tmp/izhgmu-current'));
const postsemesterDir = path.resolve(arg('--postsemester-dir', '/tmp/izhgmu-postsemester'));
const outputPath = path.resolve(arg('--output', '/tmp/izhgmu-composite/medicine6-composite-matrix.json'));
const report = JSON.parse(await fs.readFile(path.join(currentDir, 'download-report.json'), 'utf8'));

const classSources = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 6
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'class'
));
const lectureSources = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 6
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'lecture'
));
if (classSources.length !== 1 || lectureSources.length !== 1) {
  throw new Error(`Medicine-6 composite source set changed: class=${classSources.length}, lecture=${lectureSources.length}`);
}

const classSource = classSources[0];
const lectureSource = lectureSources[0];
const classBuffer = await fs.readFile(path.join(currentDir, classSource.filename));
const lectureBuffer = await fs.readFile(path.join(currentDir, lectureSource.filename));
if (sha256(classBuffer) !== classSource.sha256) throw new Error('Medicine-6 composite class SHA mismatch');
if (sha256(lectureBuffer) !== lectureSource.sha256) throw new Error('Medicine-6 composite lecture SHA mismatch');

const attestationBuffer = await fs.readFile(await findFile(postsemesterDir, 'medicine6-intermediate-attestation-2026.pdf'));
const giaBuffer = await fs.readFile(await findFile(postsemesterDir, 'medicine6-gia-2026.pdf'));
const postsemester = verifyIzhgmuMedicine6PostsemesterReview({
  intermediateAttestationBuffer: attestationBuffer,
  giaBuffer,
});

const lectureParsed = await parseIzhgmuMedicine6LectureWorkbook(lectureBuffer, {
  courseGroups: IZHGMU_MEDICINE6_EXPECTED_GROUPS,
});
if (lectureParsed.stats.courseWideCoreOccurrences !== 72) {
  throw new Error(`Medicine-6 composite lecture count changed: ${lectureParsed.stats.courseWideCoreOccurrences}/72`);
}

const expectedGroups = Array.from({ length: 30 }, (_, index) => String(601 + index));
if (JSON.stringify(IZHGMU_MEDICINE6_EXPECTED_GROUPS) !== JSON.stringify(expectedGroups)) {
  throw new Error(`Medicine-6 expected group set changed: ${JSON.stringify(IZHGMU_MEDICINE6_EXPECTED_GROUPS)}`);
}

const metadataBase = {
  academicYear: '2025/2026',
  semester: 'spring',
  facultyCode: 'medicine',
  course: 6,
  stream: null,
};
let eventCounter = 0;
const summaries = [];
for (const group of expectedGroups) {
  const cycleParsed = await parseIzhgmuMedicine6CycleWorkbook(classBuffer, { groupCode: group });
  const input = {
    cycle: {
      parsed: cycleParsed,
      source: { fileName: classSource.filename, fileHash: classSource.sha256 },
    },
    lecture: {
      parsed: lectureParsed,
      source: { fileName: lectureSource.filename, fileHash: lectureSource.sha256 },
    },
    metadata: { ...metadataBase, groupCode: group },
    postsemesterReview: postsemester.review,
  };
  const candidate = buildIzhgmuMedicine6CompositeCandidate(input);
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: '2026-08-16T00:00:00Z',
    eventIdFactory: () => `evt_izh_m6_composite_${group}_${String(++eventCounter).padStart(5, '0')}`,
    versionIdFactory: () => `ver_izh_m6_composite_${group}`,
  });
  if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
    throw new Error(`Medicine-6 composite safe QA failed for ${group}: ${JSON.stringify({ input: prepared.inputQa.errors, output: prepared.outputQa.errors })}`);
  }
  if (candidate.componentStats.cycleEvents < 1) {
    throw new Error(`Medicine-6 ${group} has no safe CYCLE events`);
  }
  if (candidate.componentStats.lectureEvents !== 72) {
    throw new Error(`Medicine-6 ${group} lecture safe events changed: ${candidate.componentStats.lectureEvents}/72`);
  }
  if (candidate.batch.events.some((event) => /^2026-06-(15|16|17|18|19)$/.test(event.timing.date) && event.timing.start_time === '08:00')) {
    throw new Error(`Medicine-6 ${group} deferred GIA state exam leaked into canonical events`);
  }
  if (group === '626' && candidate.batch.events.some((event) => /Промежуточная аттестация: (Госпитальная|Поликлиническая) терапия/.test(event.lesson.discipline.normalized))) {
    throw new Error('Medicine-6 group 626 missing therapy date was synthesized');
  }
  let productionError = null;
  try {
    buildIzhgmuMedicine6CompositeCanonicalBatch(input);
  } catch (error) {
    productionError = error;
  }
  if (productionError?.code !== 'IZH_M6_COMPOSITE_INCOMPLETE') {
    throw new Error(`Medicine-6 ${group} composite production gate changed: ${productionError?.code}`);
  }
  if (productionError.blockers?.length !== candidate.componentStats.totalBlockers) {
    throw new Error(`Medicine-6 ${group} production blocker loss: ${productionError.blockers?.length}/${candidate.componentStats.totalBlockers}`);
  }

  const blockerRows = candidate.blockers.map((blocker) => ({
    sourceComponent: blocker.source_component,
    component: blocker.component || null,
    warning: blocker.warning,
    discipline: blocker.discipline || null,
    date: blocker.date || null,
  }));
  summaries.push({
    group,
    sourceGroupSpan: cycleParsed.sourceGroupSpan,
    componentStats: candidate.componentStats,
    blockerWarnings: countBy(blockerRows, (item) => item.warning),
    blockerComponents: countBy(blockerRows, (item) => item.sourceComponent),
    blockers: blockerRows,
    deferredFacts: candidate.deferredFacts.map((fact) => ({
      kind: fact.kind,
      date: fact.date,
      startTime: fact.startTime,
      endTime: fact.endTime,
      warning: fact.warning,
    })),
    inputQa: prepared.inputQa.publishable,
    outputQa: prepared.outputQa.publishable,
    productionGate: productionError.code,
  });
}

const matrix = {
  schemaVersion: 1,
  stage: '3M',
  classSource: { filename: classSource.filename, sha256: classSource.sha256 },
  lectureSource: { filename: lectureSource.filename, sha256: lectureSource.sha256 },
  postsemesterHashes: postsemester.observedHashes,
  groupCount: summaries.length,
  groups: summaries,
  distributions: {
    cycleEvents: countBy(summaries, (item) => item.componentStats.cycleEvents),
    lectureEvents: countBy(summaries, (item) => item.componentStats.lectureEvents),
    postsemesterEvents: countBy(summaries, (item) => item.componentStats.postsemesterEvents),
    totalEvents: countBy(summaries, (item) => item.componentStats.totalEvents),
    totalBlockers: countBy(summaries, (item) => item.componentStats.totalBlockers),
  },
  observedVariations: {
    cycleEventCountNot86: summaries.filter((item) => item.componentStats.cycleEvents !== 86).map((item) => ({ group: item.group, count: item.componentStats.cycleEvents })),
    blockerCountOutsideCurrentReviewedPattern: summaries.filter((item) => item.componentStats.totalBlockers !== (item.group === '626' ? 7 : 5)).map((item) => ({ group: item.group, count: item.componentStats.totalBlockers })),
  },
  invariant: 'all_601_630_safe_subsets_pass_shared_QA; component_blockers_are_preserved; semantic_duplicates_fail_closed; GIA_end_time_and_missing_626_therapy_dates_are_never_inferred',
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
console.log('IZHGMU_MEDICINE6_COMPOSITE_MATRIX', JSON.stringify({
  groupCount: matrix.groupCount,
  distributions: matrix.distributions,
  observedVariations: matrix.observedVariations,
  output: outputPath,
  invariant: matrix.invariant,
}));
