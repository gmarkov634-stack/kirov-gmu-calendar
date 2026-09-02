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
const EXPECTED_UPPER_EVENTS = 805;
const EXPECTED_PE_DATES = 15;
const EXPECTED_EVENTS = EXPECTED_UPPER_EVENTS + EXPECTED_PE_DATES * GROUPS.length;
const EXPECTED_SOURCE_OVERLAPS = 10;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const signature = (event) => [event.groupId, event.date, event.startTime, event.endTime, event.discipline, event.lessonType, event.location ?? ''].join('|');
const minutes = (value) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
const overlaps = (left, right) => minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

const sourcePath = resolve(FIXTURE_DIR, 'pediatrics-531-537.source.json');
const jobPath = resolve(FIXTURE_DIR, 'pediatrics-531-537.parsing-job.json');
const manifestPath = resolve(FIXTURE_DIR, 'pediatrics-531-537.decisions.json');
const resolutionPath = resolve(FIXTURE_DIR, 'pediatrics-531-537.operator-resolution.json');
const reviewPath = resolve(QA_DIR, 'pediatrics-531-537.semantic-review.json');
const draftPath = resolve(QA_DIR, 'pediatrics-531-537.normalized-draft.json');
const evidencePath = resolve(QA_DIR, 'pediatrics-531-537.evidence.json');
const reportPath = resolve(QA_DIR, 'pediatrics-531-537.qa-report.json');

const [source, declaredJob, manifest, resolution, review] = await Promise.all([
  readJson(sourcePath), readJson(jobPath), readJson(manifestPath), readJson(resolutionPath), readJson(reviewPath)
]);

assert(source.source.sha256 === SOURCE_SHA, 'unexpected pinned source SHA-256');
assert(manifest.sourceSha256 === SOURCE_SHA && review.sourceSha256 === SOURCE_SHA && resolution.sourceSha256 === SOURCE_SHA, 'source SHA-256 binding mismatch');
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

assert(resolution.decisionId === AMBIGUITY_ID, 'unexpected operator resolution id');
assert(resolution.authority === 'direct-user-confirmation', 'resolution is not explicit operator confirmation');
assert(resolution.resolution.chosenInterpretation === 'weekday-label', 'PE must use the confirmed weekday-label interpretation');
assert(resolution.resolution.weekdayLabel === 'Четверг', 'confirmed PE weekday must be Thursday');
assert(resolution.resolution.expectedOccurrenceCount === EXPECTED_PE_DATES, 'expected 15 confirmed Thursday occurrences');
assert(JSON.stringify(resolution.resolution.appliesToGroups) === JSON.stringify(GROUPS), 'PE group scope mismatch');

assert(review.status === 'PASS', 'semantic review must pass after explicit operator resolution');
assert(review.unresolvedAmbiguities?.length === 0, 'no unresolved ambiguities may remain');
assert(review.resolvedAmbiguities?.length === 1 && review.resolvedAmbiguities[0].id === AMBIGUITY_ID, 'expected one resolved PE ambiguity');
assert(review.coverage.upperCycleBlockCount === 77 && review.coverage.normalizedUpperCycleBlockCount === 77, 'upper cyclic coverage mismatch');
assert(review.coverage.upperGridNormalizedEventCount === EXPECTED_UPPER_EVENTS, 'upper-grid event count mismatch');
assert(review.coverage.serviceExamBlockCount === 1, 'expected one service exam block');
assert(review.coverage.independentLowerScheduleCount === 1 && review.coverage.normalizedIndependentLowerScheduleCount === 1, 'PE lower schedule must be fully normalized');
assert(review.coverage.eventBearingLogicalSourceBlockCount === 78 && review.coverage.coveredEventBearingSourceBlockCount === 78, 'all event-bearing source blocks must be covered');
assert(review.coverage.resolvedIndependentLowerScheduleEventCount === EXPECTED_PE_DATES * GROUPS.length, 'resolved PE event count mismatch');
assert(manifest.decisionCount === 78 && manifest.decisions.length === 78, 'expected 78 explicit semantic decisions');
assert(manifest.operatorResolutions?.length === 1 && manifest.operatorResolutions[0].decisionId === AMBIGUITY_ID, 'manifest must record the operator resolution');

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const candidateDigest = digestNormalizedEvents(events);
assert(events.length === EXPECTED_EVENTS, `expected ${EXPECTED_EVENTS} normalized draft events, got ${events.length}`);

const groupEventCounts = Object.fromEntries(GROUPS.map((groupId) => [groupId, events.filter((event) => event.groupId === groupId).length]));
assert(Object.values(groupEventCounts).every((count) => count === 130), `each group must have 130 events after PE resolution: ${JSON.stringify(groupEventCounts)}`);
assert(events.every((event) => event.timeSemantics === 'floating'), 'all normalized events must preserve floating time semantics');
assert(events.every((event) => event.lessonType === 'practice'), 'all normalized course events must be practice events');
assert(events.every((event) => /^2026-2027 осень 5 курс  Пед!(?:[A-Z]+1[3-9]|BT36)$/.test(event.sourceRef.locator)), 'normalized draft contains an unexpected source locator');

const peEvents = events.filter((event) => event.sourceRef.locator.endsWith('!BT36'));
assert(peEvents.length === EXPECTED_PE_DATES * GROUPS.length, `expected ${EXPECTED_PE_DATES * GROUPS.length} PE events, got ${peEvents.length}`);
assert(new Set(peEvents.map((event) => event.date)).size === EXPECTED_PE_DATES, 'PE occurrence date count mismatch');
assert(peEvents.every((event) => event.startTime === '14:30' && event.endTime === '16:00'), 'PE time mismatch');
assert(peEvents.every((event) => new Date(`${event.date}T00:00:00Z`).getUTCDay() === 4), 'every resolved PE event must fall on Thursday');

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
      overlapSamples.push({
        groupId: dayEvents[left].groupId,
        date: dayEvents[left].date,
        left: {
          locator: dayEvents[left].sourceRef.locator,
          discipline: dayEvents[left].discipline,
          startTime: dayEvents[left].startTime,
          endTime: dayEvents[left].endTime
        },
        right: {
          locator: dayEvents[right].sourceRef.locator,
          discipline: dayEvents[right].discipline,
          startTime: dayEvents[right].startTime,
          endTime: dayEvents[right].endTime
        }
      });
    }
  }
}
assert(overlapCount === EXPECTED_SOURCE_OVERLAPS, `expected ${EXPECTED_SOURCE_OVERLAPS} source-defined overlaps, got ${overlapCount}: ${JSON.stringify(overlapSamples)}`);
assert(overlapSamples.every((sample) => {
  const pair = [sample.left, sample.right];
  return pair.some((event) => event.locator.endsWith('!BT36') && event.discipline === 'Дисциплины по физической культуре и спорту') &&
    pair.some((event) => event.discipline === 'Медицина катастроф' && event.startTime === '13:00' && event.endTime === '16:05');
}), `unexpected overlap type; C13 may only preserve explicitly grounded source conflicts here: ${JSON.stringify(overlapSamples)}`);

const disciplineEventCounts = {};
for (const event of events) disciplineEventCounts[event.discipline] = (disciplineEventCounts[event.discipline] ?? 0) + 1;

review.rulesApplied = [...new Set([...(review.rulesApplied ?? []), 'C13'])];
review.sourceConflicts = overlapSamples.map((sample) => ({
  ...sample,
  classification: 'source-defined-time-conflict',
  handling: 'preserve-both-events',
  rule: 'C13',
  blocking: false
}));
review.normalizationSummary.sourceDefinedConflictCount = overlapCount;
review.normalizationSummary.sourceDefinedConflictsBlocking = false;

const normalizedDraft = {
  schema: 'kgmu-normalized-draft-v1',
  draftId: 'normalized-draft-pediatrics-531-537-2026-09-02-v2',
  parsingJobId: declaredJob.jobId,
  sourceArtifactId: source.source.sourceArtifactId,
  sourceSha256: SOURCE_SHA,
  parserProfile: source.parserProfile,
  parserRulesVersion: source.parserRulesVersion,
  status: 'PASS',
  candidateDigest,
  eventCount: events.length,
  expectedGroupIds: GROUPS,
  events,
  diagnostics: [],
  sourceConflicts: review.sourceConflicts,
  operatorResolutions: manifest.operatorResolutions
};

const evidence = {
  fixtureId: source.fixtureId,
  sourceArtifactId: source.source.sourceArtifactId,
  sourceSha256: SOURCE_SHA,
  parsingJob: declaredJob,
  parserProfile: source.parserProfile,
  parserRulesVersion: source.parserRulesVersion,
  semanticDecisionManifest: `fixtures/${PERIOD}/pediatrics-531-537.decisions.json`,
  operatorResolution: `fixtures/${PERIOD}/pediatrics-531-537.operator-resolution.json`,
  normalizedDraft: `qa/${PERIOD}/pediatrics-531-537.normalized-draft.json`,
  candidateDigest,
  eventCount: events.length,
  groupEventCounts,
  disciplineEventCounts,
  duplicateEvents,
  datesOutsideSourceCalendar: datesOutsideSourceCalendar.length,
  sourceDefinedOverlapCount: overlapCount,
  sourceDefinedOverlapPolicy: 'C13-preserve-both-events',
  sourceDefinedOverlaps: overlapSamples,
  coverage: review.coverage,
  unresolvedAmbiguityCount: 0,
  unresolvedAmbiguityIds: [],
  qaPass: true,
  publicationAllowed: false,
  publicationNotExecutedByScope: true,
  sharedCoreChangeRequired: false
};

const checks = [
  { code: 'source-artifact-pinned', status: 'pass', message: `Official XLSX remains pinned by SHA-256 ${SOURCE_SHA} and immutable SourceArtifact metadata.` },
  { code: 'parsing-job-contract', status: 'pass', message: `ParsingJob ${declaredJob.jobId} matches the current createKgmuParsingJob contract for groups 531-537.` },
  { code: 'upper-cycle-blocks-covered', status: 'pass', message: '77/77 upper cyclic blocks normalize into 805 events under the existing G+C rules.' },
  { code: 'operator-resolution-applied', status: 'pass', message: 'PE ambiguity PED5-PE-WEEKDAY-RANGE-CONTRADICTION resolved by explicit operator confirmation: Thursdays, 15 occurrences, 14:30-16:00, groups 531-537.' },
  { code: 'event-bearing-source-coverage', status: 'pass', message: '78/78 event-bearing logical source blocks are covered after the course-specific PE resolution.' },
  { code: 'source-overlap-policy', status: 'pass', message: `${overlapCount} explicit PE/Медицина катастроф time conflicts are preserved unchanged under cyclic rule C13; they are source conflicts, not parser errors.` },
  { code: 'normalized-event-integrity', status: 'pass', message: `${events.length} events, 130 per group, 0 duplicate signatures and 0 dates outside the source calendar.` },
  { code: 'unresolved-ambiguities-zero-before-pass', status: 'pass', message: '0 unresolved ambiguities remain.' },
  { code: 'shared-core-boundary', status: 'pass', message: 'No medical-calendar-core, shared schema, shared parser/pipeline, database or production-infrastructure change is required.' },
  { code: 'publication-scope', status: 'pass', message: 'ScheduleVersion publication is intentionally not executed by this draft+QA workflow.' }
];

const report = {
  qaReportId: 'qa-kgmu-2026-2027-s1-pediatrics-531-537-v2',
  parsingJobId: declaredJob.jobId,
  sourceArtifactId: source.source.sourceArtifactId,
  candidateDigest,
  decision: 'pass',
  checks,
  createdAt: '2026-09-02T07:40:00Z'
};

await mkdir(QA_DIR, { recursive: true });
await Promise.all([
  writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8'),
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
  sourceDefinedOverlapCount: overlapCount,
  unresolvedAmbiguityCount: 0,
  qaDecision: report.decision,
  publicationAllowed: false
}, null, 2));
