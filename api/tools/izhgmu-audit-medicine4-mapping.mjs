import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuMedicine4CycleStructures } from '../src/adapters/izhgmu/cycle-medicine4.mjs';
import { parseIzhgmuMedicine4LectureStructure } from '../src/adapters/izhgmu/lecture-medicine4.mjs';
import {
  buildIzhgmuMedicine4CompositeCandidate,
  buildIzhgmuMedicine4CompositeCanonicalBatch,
} from '../src/adapters/izhgmu/medicine4-composite.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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

function expandGroupSpan(value) {
  const text = norm(value);
  if (!/^4\d{2}(?:\s*[-–]\s*4\d{2})?$/.test(text)) return [];
  const values = [...text.matchAll(/4\d{2}/g)].map((match) => Number(match[0]));
  if (values.length === 1) return [String(values[0])];
  const [start, end] = values;
  if (end < start || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function courseGroupsFromStructure(structure) {
  const spans = [];
  for (const sheet of structure.sheets || []) {
    for (const cell of sheet.cells || []) {
      const groups = expandGroupSpan(cell.value);
      if (!groups.length) continue;
      spans.push({ sheet: sheet.name, ref: cell.ref, value: norm(cell.value), groups });
    }
  }
  const groupCounts = new Map();
  for (const span of spans) for (const group of span.groups) groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  const groups = [...groupCounts.keys()].sort((a, b) => Number(a) - Number(b));
  return { groups, spans };
}

function explicitGroupEvidence(structure, courseGroups) {
  const set = new Set(courseGroups);
  const evidence = [];
  for (const sheet of structure.sheets || []) {
    for (const cell of sheet.cells || []) {
      const matches = [...norm(cell.value).matchAll(/\b4\d{2}\b/g)].map((match) => match[0]);
      const ids = [...new Set(matches.filter((id) => set.has(id)))];
      if (ids.length) evidence.push({ sheet: sheet.name, ref: cell.ref, ids, raw: norm(cell.value) });
    }
  }
  return evidence;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const outputPath = path.resolve(arg('--output', path.join(inputDir, 'medicine4-mapping-audit.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const sourceItems = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 4
  && item.language === 'ru'
  && item.term === 'spring'
));
const cycleSource = sourceItems.find((item) => item.sourceKind === 'class');
const lectureSource1 = sourceItems.find((item) => item.sourceKind === 'lecture' && Number(item.stream) === 1);
const lectureSource2 = sourceItems.find((item) => item.sourceKind === 'lecture' && Number(item.stream) === 2);
if (!cycleSource || !lectureSource1 || !lectureSource2) throw new Error('IzhGMU medicine-4 exact class/lecture source set is incomplete');

async function verifiedStructure(source) {
  const buffer = await fs.readFile(path.join(inputDir, source.filename));
  if (sha256(buffer) !== source.sha256) throw new Error(`IzhGMU medicine-4 source SHA mismatch: ${source.filename}`);
  return readIzhgmuXlsxStructure(buffer);
}

const [cycleStructure, lectureStructure1, lectureStructure2] = await Promise.all([
  verifiedStructure(cycleSource),
  verifiedStructure(lectureSource1),
  verifiedStructure(lectureSource2),
]);
const discovered = courseGroupsFromStructure(cycleStructure);
if (discovered.groups.length !== 16 || discovered.groups[0] !== '401' || discovered.groups.at(-1) !== '416') {
  throw new Error(`IzhGMU medicine-4 course group universe changed: ${JSON.stringify(discovered.groups)}`);
}

const cycleByGroup = new Map();
for (const groupCode of discovered.groups) {
  const parsed = parseIzhgmuMedicine4CycleStructures({
    classStructure: cycleStructure,
    companionStructure: cycleStructure,
    groupCode,
  });
  if (!parsed.publishable || parsed.stats.eventCount !== 95) {
    throw new Error(`IzhGMU medicine-4 cycle parse changed for ${groupCode}: ${JSON.stringify(parsed.stats)}`);
  }
  cycleByGroup.set(groupCode, parsed);
}
const representative = cycleByGroup.get('401');
const lecture1 = parseIzhgmuMedicine4LectureStructure(lectureStructure1, { stream: 1, period: representative.period });
const lecture2 = parseIzhgmuMedicine4LectureStructure(lectureStructure2, { stream: 2, period: representative.period });
for (const parsed of [lecture1, lecture2]) {
  if (parsed.stats.exactOccurrences !== 77 || parsed.stats.safeOccurrences !== 77 || parsed.stats.structuralReviewCount !== 0) {
    throw new Error(`IzhGMU medicine-4 lecture geometry changed for stream ${parsed.stream}: ${JSON.stringify(parsed.stats)}`);
  }
}

const explicitEvidence = {
  '1': explicitGroupEvidence(lectureStructure1, discovered.groups),
  '2': explicitGroupEvidence(lectureStructure2, discovered.groups),
};
if (explicitEvidence['1'].length || explicitEvidence['2'].length) {
  const error = new Error('IzhGMU medicine-4 lecture source now contains explicit 4xx group identifiers; mapping requires reviewed reassessment');
  error.code = 'IZH_M4_MAPPING_SOURCE_CHANGED';
  error.evidence = explicitEvidence;
  throw error;
}

const metadata = {
  academicYear: normalizeAcademicYear(cycleSource.academicYear),
  semester: cycleSource.term,
  facultyCode: cycleSource.faculty,
  course: Number(cycleSource.course),
  groupCode: '401',
};
const compositeInput = {
  cycle: {
    parsed: representative,
    source: { fileName: cycleSource.filename, fileHash: cycleSource.sha256 },
  },
  lectures: {
    '1': { parsed: lecture1, source: { fileName: lectureSource1.filename, fileHash: lectureSource1.sha256 } },
    '2': { parsed: lecture2, source: { fileName: lectureSource2.filename, fileHash: lectureSource2.sha256 } },
  },
  metadata,
  courseGroups: discovered.groups,
};
const candidate = buildIzhgmuMedicine4CompositeCandidate(compositeInput);
if (candidate.selectedStream !== null || candidate.componentStats.lectureEvents !== 0 || candidate.componentStats.cycleEvents !== 95) {
  throw new Error(`IzhGMU medicine-4 no-map QA boundary leaked lecture attribution: ${JSON.stringify(candidate.componentStats)}`);
}
if (candidate.blockers.length !== 1 || candidate.blockers[0].warning !== 'stream_group_mapping_required') {
  throw new Error(`IzhGMU medicine-4 no-map blocker boundary changed: ${JSON.stringify(candidate.blockers)}`);
}
const publication = prepareSchedulePublication(candidate.batch, { now: '2026-08-17T00:00:00.000Z' });
if (!publication.inputQa.publishable || !publication.outputQa.publishable || publication.batch.events.length !== 95) {
  throw new Error(`IzhGMU medicine-4 safe class-only candidate failed shared QA: ${JSON.stringify({ input: publication.inputQa, output: publication.outputQa })}`);
}

let hardFailure = null;
try {
  buildIzhgmuMedicine4CompositeCanonicalBatch(compositeInput);
} catch (error) {
  hardFailure = { code: error?.code || null, message: error?.message || String(error) };
}
if (hardFailure?.code !== 'IZH_M4_STREAM_GROUP_MAPPING_REQUIRED') {
  throw new Error(`IzhGMU medicine-4 hard gate did not fail on audience mapping: ${JSON.stringify(hardFailure)}`);
}

const result = {
  version: 1,
  course: 4,
  academicYear: metadata.academicYear,
  semester: metadata.semester,
  groupCount: discovered.groups.length,
  groups: discovered.groups,
  sourceGroupSpans: discovered.spans,
  cycle: {
    sourceFile: cycleSource.filename,
    sourceHash: cycleSource.sha256,
    groupsParsed: cycleByGroup.size,
    eventsPerGroup: [...new Set([...cycleByGroup.values()].map((parsed) => parsed.stats.eventCount))],
    representativeGroup: '401',
    representativeGroupSpan: representative.sourceGroupSpan,
  },
  streams: {
    '1': {
      sourceFile: lectureSource1.filename,
      sourceHash: lectureSource1.sha256,
      sourceRows: lecture1.stats.sourceRows,
      exactOccurrences: lecture1.stats.exactOccurrences,
      structuralReviewCount: lecture1.stats.structuralReviewCount,
      explicitGroupIds: [],
    },
    '2': {
      sourceFile: lectureSource2.filename,
      sourceHash: lectureSource2.sha256,
      sourceRows: lecture2.stats.sourceRows,
      exactOccurrences: lecture2.stats.exactOccurrences,
      structuralReviewCount: lecture2.stats.structuralReviewCount,
      explicitGroupIds: [],
    },
  },
  mapping: {
    status: 'unresolved',
    evidenceInLectureWorkbooks: explicitEvidence,
    blocker: 'stream_group_mapping_required',
    hardFailure,
  },
  representativeQa: {
    group: '401',
    events: publication.batch.events.length,
    inputQa: publication.inputQa.publishable,
    outputQa: publication.outputQa.publishable,
    lectureEventsAttributed: candidate.componentStats.lectureEvents,
  },
  productionAuthorized: false,
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE4_MAPPING_AUDIT', JSON.stringify(result));
