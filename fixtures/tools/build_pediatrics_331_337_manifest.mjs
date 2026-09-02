import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';

const SOURCE_PATH = 'fixtures/2026-2027-semester-1/pediatrics-331-337.source.json';
const PLAN_PATH = 'qa/2026-2027-semester-1/pediatrics-331-337.date-plan.json';
const REVIEW_PATH = 'qa/2026-2027-semester-1/pediatrics-331-337.semantic-review.json';
const MANIFEST_PATH = 'fixtures/2026-2027-semester-1/pediatrics-331-337.decisions.json';
const EVIDENCE_PATH = 'qa/2026-2027-semester-1/pediatrics-331-337.evidence.json';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
}

function hexMask(table, selected) {
  let mask = 0n;
  for (const value of selected) {
    const index = table.indexOf(value);
    if (index < 0) throw new Error(`unknown mask value: ${value}`);
    mask |= 1n << BigInt(index);
  }
  if (mask === 0n) throw new Error('mask must not be zero');
  return mask.toString(16);
}

function explicitLectureLocation(sourceTail) {
  const match = sourceTail.match(
    /([123])\s+корпус,?\s+аудитория\s+(\d+)\s+ул\.\s+Владимирская,\s*(\d+)/i
  );
  if (!match) return null;
  return `${match[1]} корпус, аудитория ${match[2]}, ул. Владимирская, ${match[3]}`;
}

const PRACTICE_LOCATION = new Map([
  ['Микробиология, вирусология', '3 корпус, ул. Владимирская, 112'],
  ['Иммунология', '3 корпус, ул. Владимирская, 112'],
  ['Гигиена', '3 корпус, ул. Владимирская, 112'],
  ['Фармакология', '3 корпус, ул. Владимирская, 112'],
  ['Патологическая анатомия, клиническая патологическая анатомия, патологическая анатомия (модуль)', '3 корпус, ул. Владимирская, 112'],
  ['Патофизиология, клиническая патофизиология. Патофизиология (модуль)', '3 корпус, ул. Владимирская, 112'],
  ['Топографическая анатомия и оперативная хирургия', '2 корпус, ул. Пролетарская, 38'],
  ['Элективные дисциплины (модули) по физической культуре и спорту', 'ФОК, 3 корпус, ул. Владимирская, 112']
]);

function resolveLocation(segment) {
  if (segment.lessonType === 'lecture') {
    const explicit = explicitLectureLocation(segment.sourceTail);
    if (explicit) return explicit;
  }
  return PRACTICE_LOCATION.get(segment.discipline) ?? null;
}

function assessmentMetadata(disciplineTable) {
  const definitions = new Map([
    ['Микробиология, вирусология', { type: 'exam', label: 'экзамен', locator: '3пед.!E36' }],
    ['Иммунология', { type: 'credit', label: 'зачет', locator: '3пед.!I36' }],
    ['Гигиена', { type: 'exam', label: 'экзамен', locator: '3пед.!E37' }],
    ['Пропедевтика внутренних болезней', { type: 'exam', label: 'экзамен', locator: '3пед.!E38' }],
    ['Общая хирургия', { type: 'exam', label: 'экзамен', locator: '3пед.!E39' }],
    ['Учебная практика. Практика по получению первичных профессиональных умений и навыков диагностического профиля', { type: 'credit', label: 'зачет', locator: '3пед.!E41' }]
  ]);
  const result = {};
  for (const [discipline, metadata] of definitions) {
    const index = disciplineTable.indexOf(discipline);
    if (index < 0) continue;
    result[String(index)] = {
      type: metadata.type,
      label: metadata.label,
      sourceRef: { sourceId: 'pediatrics', locator: metadata.locator }
    };
  }
  return result;
}

function countByGroup(events) {
  return Object.fromEntries(
    [...events.reduce((counts, event) => {
      counts.set(event.groupId, (counts.get(event.groupId) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([a], [b]) => Number(a) - Number(b))
  );
}

const source = await readJson(SOURCE_PATH);
const plan = await readJson(PLAN_PATH);
const review = await readJson(REVIEW_PATH);

if (plan.sourceSha256 !== source.source.sha256 || review.sourceSha256 !== source.source.sha256) {
  throw new Error('source SHA mismatch across manifest inputs');
}
if (plan.reviewRequiredCellCount !== 0 || plan.sourceCellCount !== 98 || plan.plannedSegmentCount !== 131) {
  throw new Error('date plan is not complete');
}
if (review.status !== 'PASS' || review.blocksPublication !== false || review.unresolvedAmbiguities.length !== 0) {
  throw new Error('semantic review is not resolved');
}
if (review.resolvedAmbiguities[0]?.confirmationId !== 'USER-2026-09-02-PED3-KEEP-07-12') {
  throw new Error('required operator confirmation is missing');
}

const groupTable = source.expectedGroupIds;
const allSegments = plan.cells.flatMap((cell) =>
  cell.segments.map((segment) => ({ ...segment, groups: cell.groups, sourceLocator: cell.sourceLocator }))
);
const dateTable = [...new Set(allSegments.flatMap((segment) => segment.occurrences.map((o) => o.date)))].sort();
const disciplineTable = [...new Set(allSegments.map((segment) => segment.discipline))].sort((a, b) => a.localeCompare(b, 'ru'));
const lessonTypeTable = ['lecture', 'practice'];
const resolvedLocations = allSegments.map(resolveLocation);
const locationTable = [...new Set(resolvedLocations.map((value) => JSON.stringify(value)))].map((value) => JSON.parse(value));

const decisions = [];
for (const segment of allSegments) {
  const byTime = new Map();
  for (const occurrence of segment.occurrences) {
    const key = `${occurrence.startTime}|${occurrence.endTime}`;
    const values = byTime.get(key) ?? [];
    values.push(occurrence.date);
    byTime.set(key, values);
  }
  const sortedTimes = [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sourceCell = segment.sourceLocator.replace(/^3пед\.!/, '');
  for (const [timeIndex, [timeKey, dates]] of sortedTimes.entries()) {
    const [startTime, endTime] = timeKey.split('|');
    const locator = sortedTimes.length === 1
      ? segment.segmentId
      : `${segment.segmentId}#t${timeIndex + 1}`;
    if (!locator.startsWith(sourceCell)) {
      throw new Error(`segment locator ${locator} does not retain source cell ${sourceCell}`);
    }
    const location = resolveLocation(segment);
    decisions.push([
      locator,
      hexMask(groupTable, segment.groups),
      hexMask(dateTable, dates),
      startTime,
      endTime,
      disciplineTable.indexOf(segment.discipline),
      lessonTypeTable.indexOf(segment.lessonType),
      locationTable.findIndex((candidate) => candidate === location)
    ]);
  }
}

const manifest = {
  schema: 'kgmu-explicit-semantic-decisions-v3',
  fixtureId: source.fixtureId,
  sourceSha256: source.source.sha256,
  parserRulesVersion: source.parserRulesVersion,
  sheetName: '3пед.',
  semanticDecisionMode: 'operator-authored-explicit',
  logicalSourceCellCount: plan.sourceSegmentCount,
  decisionCount: decisions.length,
  dateTable,
  disciplineTable,
  locationTable,
  assessmentMetadataByDisciplineIndex: assessmentMetadata(disciplineTable),
  groupTable,
  lessonTypeTable,
  tupleFields: [
    'locator', 'groupMaskHex', 'dateMaskHex', 'startTime', 'endTime',
    'disciplineIndex', 'lessonTypeIndex', 'locationIndex'
  ],
  decisions
};

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
manifest.candidateDigest = digestNormalizedEvents(events);

const mondayMicrobiology333 = events.filter((event) =>
  event.groupId === '333' &&
  event.discipline === 'Микробиология, вирусология' &&
  new Date(`${event.date}T00:00:00Z`).getUTCDay() === 1
);
const explicitResolved = mondayMicrobiology333.filter((event) => event.date === '2026-12-07');
if (explicitResolved.length !== 1) {
  throw new Error(`expected exactly one group 333 Monday Microbiology event on 2026-12-07, got ${explicitResolved.length}`);
}
// The resolved source inconsistency must not produce an invented second Monday event
// from D20. Other independently explicit Monday Microbiology facts, if ever added,
// must be reviewed separately rather than silently accepted here.
const d20SyntheticMonday = mondayMicrobiology333.filter((event) =>
  event.sourceRef.locator.startsWith('3пед.!D20')
);
if (d20SyntheticMonday.length !== 0) {
  throw new Error('D20 generated a synthetic Monday Microbiology occurrence');
}

const nullLocationDisciplines = [...new Set(events.filter((event) => event.location == null).map((event) => event.discipline))].sort((a, b) => a.localeCompare(b, 'ru'));
const evidence = {
  schema: 'kgmu-normalized-candidate-evidence-v1',
  fixtureId: source.fixtureId,
  sourceSha256: source.source.sha256,
  candidateDigest: manifest.candidateDigest,
  sourceCellCount: plan.sourceCellCount,
  sourceSegmentCount: plan.sourceSegmentCount,
  decisionCount: manifest.decisionCount,
  eventCount: events.length,
  groupEventCounts: countByGroup(events),
  firstDate: events[0]?.date ?? null,
  lastDate: events.at(-1)?.date ?? null,
  unresolvedAmbiguities: review.unresolvedAmbiguities.length,
  operatorConfirmationIds: review.resolvedAmbiguities.map((item) => item.confirmationId),
  group333MondayMicrobiology: mondayMicrobiology333.map((event) => ({
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    sourceLocator: event.sourceRef.locator
  })),
  d20SyntheticMondayCount: d20SyntheticMonday.length,
  locationPolicy: {
    ambiguousClinicalBasesUseNull: true,
    suspiciousSourceLiteralCorrected: false,
    nullLocationDisciplines
  }
};

await mkdir(dirname(new URL(`../../${MANIFEST_PATH}`, import.meta.url).pathname), { recursive: true });
await mkdir(dirname(new URL(`../../${EVIDENCE_PATH}`, import.meta.url).pathname), { recursive: true });
await writeFile(new URL(`../../${MANIFEST_PATH}`, import.meta.url), `${JSON.stringify(manifest)}\n`, 'utf8');
await writeFile(new URL(`../../${EVIDENCE_PATH}`, import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  decisionCount: manifest.decisionCount,
  eventCount: events.length,
  candidateDigest: manifest.candidateDigest,
  groupEventCounts: evidence.groupEventCounts,
  unresolvedAmbiguities: evidence.unresolvedAmbiguities,
  d20SyntheticMondayCount: evidence.d20SyntheticMondayCount,
  nullLocationDisciplines: evidence.locationPolicy.nullLocationDisciplines
}, null, 2));
