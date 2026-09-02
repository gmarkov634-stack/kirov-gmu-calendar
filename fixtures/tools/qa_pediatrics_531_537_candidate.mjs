#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKgmuParsingJob } from '../../src/index.js';
import { digestNormalizedEvents, expandExplicitDecisionManifest } from '../../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PERIOD = '2026-2027-semester-1';
const FIXTURE_DIR = resolve(ROOT, 'fixtures', PERIOD);
const QA_DIR = resolve(ROOT, 'qa', PERIOD);
const GROUPS = ['531', '532', '533', '534', '535', '536', '537'];
const SOURCE_SHA = '190d990d2c505490696d04339f13450f03085c85db997ec3ff5b047ac1c27024';
const AMBIGUITY_ID = 'PED5-PE-WEEKDAY-RANGE-CONTRADICTION';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const signature = (event) => [
  event.groupId,
  event.date,
  event.startTime,
  event.endTime,
  event.discipline,
  event.lessonType,
  event.location ?? ''
].join('|');
const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

const sourcePath = resolve(FIXTURE_DIR, 'pediatrics-531-537.source.json');
const jobPath = resolve(FIXTURE_DIR, 'pediatrics-531-537.parsing-job.json');
const manifestPath = resolve(FIXTURE_DIR, 'pediatrics-531-537.decisions.json');
const reviewPath = resolve(QA_DIR, 'pediatrics-531-537.semantic-review.json');
const draftPath = resolve(QA_DIR, 'pediatrics-531-537.normalized-draft.json');
const evidencePath = resolve(QA_DIR, 'pediatrics-531-537.evidence.json');
const reportPath = resolve(QA_DIR, 'pediatrics-531-537.qa-report.json');

const [source, declaredJob, manifest, review] = await Promise.all([
  readJson(sourcePath),
  readJson(jobPath),
  readJson(manifestPath),
  readJson(reviewPath)
]);

assert(source.source.sha256 === SOURCE_SHA, 'unexpected pinned source SHA-256');
assert(manifest.sourceSha256 === SOURCE_SHA, 'manifest/source SHA-256 mismatch');
assert(review.sourceSha256 === SOURCE_SHA, 'review/source SHA-256 mismatch');
assert(JSON.stringify(source.expectedGroupIds) === JSON.stringify(GROUPS), 'source group set mismatch');
assert(JSON.stringify(manifest.groupTable) === JSON.stringify(GROUPS), 'manifest group set mismatch');
assert(review.parserProfile === 'cyclic', 'expected cyclic parser profile');
assert(source.parserRulesVersion === 'kgmu-2026-08-27-v3', 'unexpected parser rules version');

const job = createKgmuParsingJob({
  jobId: declaredJob.jobId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId,
  sourceObjectKey: source.source.objectKey,
  parserRulesVersion: source.parserRulesVersion,
  expectedGroupIds: source.expectedGroupIds,
  requestedAt: declaredJob.requestedAt
});
assert(JSON.stringify(job) === JSON.stringify(declaredJob), 'declared ParsingJob differs from current createKgmuParsingJob contract');

assert(review.status === 'REVIEW_REQUIRED', 'semantic review must fail closed while PE conflict is unresolved');
assert(review.unresolvedAmbiguities?.length === 1, 'expected exactly one unresolved ambiguity');
assert(review.unresolvedAmbiguities[0].id === AMBIGUITY_ID, 'unexpected unresolved ambiguity id');
assert(review.coverage.upperCycleBlockCount === 77, 'expected 77 upper cycle blocks');
assert(review.coverage.normalizedUpperCycleBlockCount === 77, 'all upper cycle blocks must normalize');
assert(review.coverage.upperGridNormalizedEventCount === 805, 'expected 805 upper-grid normalized events');
assert(review.coverage.serviceExamBlockCount === 1, 'expected one service exam block');
assert(review.coverage.independentLowerScheduleCount === 1, 'expected one independent lower schedule');
assert(review.coverage.normalizedIndependentLowerScheduleCount === 0, 'ambiguous PE schedule must not be normalized');
assert(review.coverage.eventBearingLogicalSourceBlockCount === 78, 'expected 78 event-bearing logical source blocks');
assert(review.coverage.coveredEventBearingSourceBlockCount === 77, 'expected 77/78 event-bearing blocks covered before confirmation');

const ambiguity = review.unresolvedAmbiguities[0];
assert(ambiguity.facts.weekdayLabel === 'Четверг', 'PE weekday label must be preserved');
assert(ambiguity.facts.rangeStart === '2026-09-04', 'PE range start must be preserved');
assert(ambiguity.facts.rangeEnd === '2026-12-18', 'PE range end must be preserved');
assert(ambiguity.facts.rangeStartWeekday === 'Friday' && ambiguity.facts.rangeEndWeekday === 'Friday', 'PE endpoint weekday evidence changed');
assert(ambiguity.facts.thursdayInterpretation.dateCount === 15, 'expected 15 Thursdays in source range');
assert(ambiguity.facts.fridayRangeEndpointInterpretation.dateCount === 16, 'expected 16 Fridays in source range');

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const candidateDigest = digestNormalizedEvents(events);
assert(events.length === 805, `expected 805 normalized draft events, got ${events.length}`);

const groupEventCounts = Object.fromEntries(GROUPS.map((groupId) => [
  groupId,
  events.filter((event) => event.groupId === groupId).length
]));
assert(Object.values(groupEventCounts).every((count) => count === 115), `each group must have 115 upper-grid events: ${JSON.stringify(groupEventCounts)}`);
assert(events.every((event) => event.timeSemantics === 'floating'), 'all normalized events must preserve floating time semantics');
assert(events.every((event) => event.lessonType === 'practice'), 'all upper cyclic events must be practice events');
assert(events.every((event) => /^2026-2027 осень 5 курс  Пед![A-Z]+1[3-9]$/.test(event.sourceRef.locator)), 'normalized draft contains a non-upper-grid source locator');

const seen = new Set();
let duplicateEvents = 0;
for (const event of events) {
  const key = signature(event);
  if (seen.has(key)) duplicateEvents += 1;
  seen.add(key);
}
assert(duplicateEvents === 0, `duplicate normalized event signatures: ${duplicateEvents}`);

const sourceDates = new Set(manifest.dateTable);
const datesOutsideSourceCalendar = events.filter((event) => !sourceDates.has(event.date));
assert(datesOutsideSourceCalendar.length === 0, `events outside source calendar: ${datesOutsideSourceCalendar.length}`);

const byGroupDate = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  if (!byGroupDate.has(key)) byGroupDate.set(key, []);
  byGroupDate.get(key).push(event);
}
let overlapCount = 0;
const overlapSamples = [];
for (const dayEvents of byGroupDate.values()) {
  for (let left = 0; left < dayEvents.length; left += 1) {
    for (let right = left + 1; right < dayEvents.length; right += 1) {
      if (!overlaps(dayEvents[left], dayEvents[right])) continue;
      overlapCount += 1;
      if (overlapSamples.length < 20) {
        overlapSamples.push({
          groupId: dayEvents[left].groupId,
          date: dayEvents[left].date,
          left: dayEvents[left].sourceRef.locator,
          right: dayEvents[right].sourceRef.locator
        });
      }
    }
  }
}
assert(overlapCount === 0, `unexpected overlap in upper cyclic draft: ${overlapCount}`);

const disciplineEventCounts = {};
for (const event of events) disciplineEventCounts[event.discipline] = (disciplineEventCounts[event.discipline] ?? 0) + 1;

const normalizedDraft = {
  schema: 'kgmu-normalized-draft-v1',
  draftId: 'normalized-draft-pediatrics-531-537-2026-09-02-v1',
  parsingJobId: declaredJob.jobId,
  sourceArtifactId: source.source.sourceArtifactId,
  sourceSha256: SOURCE_SHA,
  parserProfile: source.parserProfile,
  parserRulesVersion: source.parserRulesVersion,
  status: 'REVIEW_REQUIRED',
  candidateDigest,
  eventCount: events.length,
  expectedGroupIds: GROUPS,
  events,
  diagnostics: review.unresolvedAmbiguities
};

const evidence = {
  fixtureId: source.fixtureId,
  sourceArtifactId: source.source.sourceArtifactId,
  sourceSha256: SOURCE_SHA,
  parsingJob: declaredJob,
  parserProfile: source.parserProfile,
  parserRulesVersion: source.parserRulesVersion,
  semanticDecisionManifest: 'fixtures/2026-2027-semester-1/pediatrics-531-537.decisions.json',
  normalizedDraft: 'qa/2026-2027-semester-1/pediatrics-531-537.normalized-draft.json',
  candidateDigest,
  eventCount: events.length,
  groupEventCounts,
  disciplineEventCounts,
  duplicateEvents,
  datesOutsideSourceCalendar: datesOutsideSourceCalendar.length,
  overlapCount,
  overlapSamples,
  coverage: review.coverage,
  unresolvedAmbiguityCount: review.unresolvedAmbiguities.length,
  unresolvedAmbiguityIds: review.unresolvedAmbiguities.map((item) => item.id),
  publicationAllowed: false,
  sharedCoreChangeRequired: false
};

const checks = [
  {
    code: 'source-artifact-pinned',
    status: 'pass',
    message: `Official XLSX is pinned by SHA-256 ${SOURCE_SHA}, immutable object key and workbook geometry 43x125.`
  },
  {
    code: 'parsing-job-contract',
    status: 'pass',
    message: `ParsingJob ${declaredJob.jobId} exactly matches the current createKgmuParsingJob contract and expected groups 531-537.`
  },
  {
    code: 'upper-cycle-blocks-covered',
    status: 'pass',
    message: '77/77 upper cyclic blocks normalized under existing G+C rules into 805 events.'
  },
  {
    code: 'service-exam-period-classified',
    status: 'pass',
    message: 'DN13:DT19 is classified as a service exam period under C07/C14 and creates no event.'
  },
  {
    code: 'normalized-event-integrity',
    status: 'pass',
    message: '805 events, 115 per group, 0 duplicates, 0 out-of-calendar dates and 0 upper-grid overlaps.'
  },
  {
    code: 'shared-core-boundary',
    status: 'pass',
    message: 'No medical-calendar-core, shared schema, shared pipeline, database, publication or production infrastructure change is required for the normalized upper-grid draft.'
  },
  {
    code: 'unresolved-ambiguities-zero-before-pass',
    status: 'review_required',
    message: '1 blocking source ambiguity remains: BT36 says Thursday, while the explicit range endpoints 04.09.2026 and 18.12.2026 are Fridays. G04/G21 prohibit choosing an interpretation without confirmation.'
  },
  {
    code: 'publication-gate',
    status: 'blocked',
    message: 'ScheduleVersion publication remains blocked; this workflow creates draft/QA evidence only.'
  }
];

const report = {
  qaReportId: 'qa-kgmu-2026-2027-s1-pediatrics-531-537-v1',
  parsingJobId: declaredJob.jobId,
  sourceArtifactId: source.source.sourceArtifactId,
  candidateDigest,
  decision: 'review_required',
  checks,
  createdAt: '2026-09-02T05:20:00Z'
};

await mkdir(QA_DIR, { recursive: true });
await Promise.all([
  writeFile(draftPath, `${JSON.stringify(normalizedDraft)}\n`, 'utf8'),
  writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
]);

console.log(JSON.stringify({
  sourceArtifactId: source.source.sourceArtifactId,
  parsingJobId: declaredJob.jobId,
  candidateDigest,
  eventCount: events.length,
  groupEventCounts,
  duplicateEvents,
  overlapCount,
  unresolvedAmbiguityCount: review.unresolvedAmbiguities.length,
  qaDecision: report.decision,
  publicationAllowed: false
}, null, 2));
