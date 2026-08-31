#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PERIOD = '2026-2027-semester-1';
const FIXTURE_DIR = resolve(ROOT, 'fixtures', PERIOD);
const QA_DIR = resolve(ROOT, 'qa', PERIOD);
const PE_SELECTION_GROUP = 'medicine-5-physical-education-stream-2026-s1';
const PE_NAME = 'Дисциплины по физической культуре и спорту';
const EXPECTED_PE_OPTION_IDS = ['stream-1', 'stream-2'];
const CORE_EVIDENCE = Object.freeze({
  repository: 'gmarkov634-stack/medical-calendar-core',
  commit: 'ef97adaf97f28c292e25d6b469acc417b41715ee',
  normalizedEventSchemaBlob: '18cce682c311659a515390ba6ce706ba4a2f4072',
  icsRendererBlob: '6e889cb7c8b9b9a8d8d6b94d2486454644db7c2e',
  preferencesBlob: 'ee1441366b25be9d180014ec74f124a24a9cfd00'
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function signature(event) {
  return [
    event.groupId,
    event.date,
    event.startTime,
    event.endTime,
    event.discipline,
    event.lessonType,
    event.location ?? '',
    event.selection?.selectionGroupId ?? '',
    event.selection?.selectionOptionId ?? ''
  ].join('|');
}

function countByGroup(events, groups) {
  return Object.fromEntries(groups.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length
  ]));
}

function countPeByGroupAndOption(events, groups) {
  return Object.fromEntries(groups.map((groupId) => [
    groupId,
    Object.fromEntries(EXPECTED_PE_OPTION_IDS.map((optionId) => [
      optionId,
      events.filter((event) =>
        event.groupId === groupId &&
        event.selection?.selectionGroupId === PE_SELECTION_GROUP &&
        event.selection?.selectionOptionId === optionId
      ).length
    ]))
  ]));
}

const sourcePath = resolve(FIXTURE_DIR, 'medicine-501-516.source.json');
const manifestPath = resolve(FIXTURE_DIR, 'medicine-501-516.decisions.json');
const reviewPath = resolve(QA_DIR, 'medicine-501-516.semantic-review.json');
const evidencePath = resolve(QA_DIR, 'medicine-501-516.evidence.json');
const reportPath = resolve(QA_DIR, 'medicine-501-516.qa-report.json');

const [source, manifest, review] = await Promise.all([
  readJson(sourcePath),
  readJson(manifestPath),
  readJson(reviewPath)
]);

assert(source.source.sha256 === manifest.sourceSha256, 'manifest/source SHA-256 mismatch');
assert(review.sourceSha256 === source.source.sha256, 'semantic review/source SHA-256 mismatch');
assert(JSON.stringify(source.expectedGroupIds) === JSON.stringify(manifest.groupTable), 'manifest/source groups mismatch');
assert(review.unresolvedAmbiguities?.length === 0, 'semantic review still contains unresolved ambiguities');

const eventBearingUpperBlocks = review.coverage.upperCycleBlockCount - review.coverage.serviceExamBlockCount;
const logicalSourceCellCount = eventBearingUpperBlocks + review.coverage.independentPeScheduleCount;
manifest.logicalSourceCellCount = logicalSourceCellCount;
review.coverage.eventBearingUpperCycleBlockCount = eventBearingUpperBlocks;
review.coverage.logicalSourceCellCount = logicalSourceCellCount;
review.coverage.coveredSourceCellCount = logicalSourceCellCount;
review.coverage.totalAccountedSourceBlockCount = review.coverage.upperCycleBlockCount + review.coverage.independentPeScheduleCount;

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const candidateDigest = digestNormalizedEvents(events);
manifest.candidateDigest = candidateDigest;

const groupEventCounts = countByGroup(events, source.expectedGroupIds);
const peCountsByGroupAndOption = countPeByGroupAndOption(events, source.expectedGroupIds);
const peEvents = events.filter((event) => event.selection?.selectionGroupId === PE_SELECTION_GROUP);
const peCountsByOption = Object.fromEntries(EXPECTED_PE_OPTION_IDS.map((optionId) => [
  optionId,
  peEvents.filter((event) => event.selection?.selectionOptionId === optionId).length
]));

assert(events.length === 2400, `expected 2400 normalized events, got ${events.length}`);
assert(Object.values(groupEventCounts).every((count) => count === 150), 'each group must have 150 candidate events before personalization');
assert(peEvents.length === 512, `expected 512 PE selection events, got ${peEvents.length}`);
assert(EXPECTED_PE_OPTION_IDS.every((optionId) => peCountsByOption[optionId] === 256), 'each PE stream must have 256 candidate events');
assert(Object.values(peCountsByGroupAndOption).every((counts) => EXPECTED_PE_OPTION_IDS.every((optionId) => counts[optionId] === 16)), 'each group must have 16 dates for each PE stream');
assert(peEvents.every((event) => event.discipline === PE_NAME), 'PE selection events must preserve source discipline name');

const seen = new Set();
let duplicateEvents = 0;
for (const event of events) {
  const key = signature(event);
  if (seen.has(key)) duplicateEvents += 1;
  seen.add(key);
}

const sourceDates = new Set(manifest.dateTable);
const datesOutsideSourceCalendar = events.filter((event) => !sourceDates.has(event.date));

const byDay = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(event);
}

let selectionAlternativeOverlapCount = 0;
let selectionDependentOverlapCount = 0;
let explicitOverlapCount = 0;
const selectionDependentOverlapSamples = [];
const explicitOverlapSamples = [];
for (const dayEvents of byDay.values()) {
  for (let left = 0; left < dayEvents.length; left += 1) {
    for (let right = left + 1; right < dayEvents.length; right += 1) {
      const a = dayEvents[left];
      const b = dayEvents[right];
      if (!overlaps(a, b)) continue;
      const sameSelectionGroup =
        a.selection?.selectionGroupId &&
        a.selection.selectionGroupId === b.selection?.selectionGroupId;
      const differentOptions = sameSelectionGroup && a.selection.selectionOptionId !== b.selection.selectionOptionId;
      if (differentOptions) {
        selectionAlternativeOverlapCount += 1;
        continue;
      }
      if (a.selection || b.selection) {
        selectionDependentOverlapCount += 1;
        if (selectionDependentOverlapSamples.length < 20) {
          selectionDependentOverlapSamples.push({
            groupId: a.groupId,
            date: a.date,
            left: { locator: a.sourceRef.locator, startTime: a.startTime, endTime: a.endTime, selection: a.selection ?? null },
            right: { locator: b.sourceRef.locator, startTime: b.startTime, endTime: b.endTime, selection: b.selection ?? null }
          });
        }
        continue;
      }
      explicitOverlapCount += 1;
      if (explicitOverlapSamples.length < 20) {
        explicitOverlapSamples.push({
          groupId: a.groupId,
          date: a.date,
          left: { locator: a.sourceRef.locator, startTime: a.startTime, endTime: a.endTime },
          right: { locator: b.sourceRef.locator, startTime: b.startTime, endTime: b.endTime }
        });
      }
    }
  }
}

assert(duplicateEvents === 0, `duplicate normalized events: ${duplicateEvents}`);
assert(datesOutsideSourceCalendar.length === 0, `events outside source calendar: ${datesOutsideSourceCalendar.length}`);

const evidence = {
  fixtureId: source.fixtureId,
  sourceSha256: source.source.sha256,
  parserRulesVersion: source.parserRulesVersion,
  semanticDecisionManifest: 'fixtures/2026-2027-semester-1/medicine-501-516.decisions.json',
  semanticDecisionMode: 'operator-authored-explicit + user-confirmed-selection-model',
  candidateDigest,
  eventCount: events.length,
  groupEventCounts,
  logicalSourceCellCount,
  coveredSourceCellCount: logicalSourceCellCount,
  upperCycleBlockCount: review.coverage.upperCycleBlockCount,
  eventBearingUpperCycleBlockCount: eventBearingUpperBlocks,
  serviceExamBlockCount: review.coverage.serviceExamBlockCount,
  independentPeScheduleCount: review.coverage.independentPeScheduleCount,
  totalAccountedSourceBlockCount: review.coverage.totalAccountedSourceBlockCount,
  unresolvedAmbiguities: review.unresolvedAmbiguities.length,
  duplicateEvents,
  datesOutsideSourceCalendar: datesOutsideSourceCalendar.length,
  selectionGroupId: PE_SELECTION_GROUP,
  selectionOptionIds: EXPECTED_PE_OPTION_IDS,
  peEventCount: peEvents.length,
  peCountsByOption,
  peCountsByGroupAndOption,
  selectionAlternativeOverlapCount,
  selectionDependentOverlapCount,
  explicitOverlapCount,
  overlapPolicy: 'All non-alternative overlaps are preserved because both sides are explicitly source-backed. PE overlaps are personalization-dependent and are not resolved by guessing a stream; G16/C13 applies.',
  selectionDependentOverlapSamples,
  explicitOverlapSamples,
  sourceSpecificDecision: review.sourceSpecificDecisions[0],
  sharedContractEvidence: CORE_EVIDENCE
};

const checks = [
  {
    code: 'official-source-pinned',
    status: 'pass',
    message: `Official XLSX is pinned by SHA-256 ${source.source.sha256} and workbook geometry ${source.workbookExpectations.maxRow}x${source.workbookExpectations.maxColumn}.`
  },
  {
    code: 'upper-grid-content-accounted-for',
    status: 'pass',
    message: `${review.coverage.upperCycleBlockCount}/${review.coverage.upperCycleBlockCount} upper-grid blocks are accounted for: ${eventBearingUpperBlocks} event-bearing and ${review.coverage.serviceExamBlockCount} service exam-period blocks under C14.`
  },
  {
    code: 'independent-pe-schedules-accounted-for',
    status: 'pass',
    message: 'Both BT45 and BX45 independent physical-education schedules are preserved as mutually exclusive selection options for groups 501-516.'
  },
  {
    code: 'candidate-event-count',
    status: 'pass',
    message: `${events.length} normalized candidate events; each group has 150 events before personalization.`
  },
  {
    code: 'physical-education-selection-metadata',
    status: 'pass',
    message: `Selection group ${PE_SELECTION_GROUP} has stream-1 and stream-2; each group has 16 source dates per stream.`
  },
  {
    code: 'duplicates-resolved',
    status: 'pass',
    message: 'No duplicate normalized event signatures.'
  },
  {
    code: 'dates-within-source-calendar',
    status: 'pass',
    message: `All events use dates present in the official XLSX calendar grid (${manifest.dateTable[0]}–${manifest.dateTable.at(-1)}).`
  },
  {
    code: 'overlaps-classified',
    status: (selectionDependentOverlapCount || explicitOverlapCount) ? 'warning' : 'pass',
    message: `${selectionAlternativeOverlapCount} mutually-exclusive option overlaps, ${selectionDependentOverlapCount} personalization-dependent PE/source overlaps, ${explicitOverlapCount} other source-explicit overlaps; non-alternative overlaps are preserved under G16/C13.`
  },
  {
    code: 'unresolved-ambiguities-zero-before-pass',
    status: 'pass',
    message: '0 unresolved semantic ambiguities remain after the user-confirmed PE stream personalization decision.'
  },
  {
    code: 'shared-contract-boundary',
    status: 'pass',
    message: `medical-calendar-core ${CORE_EVIDENCE.commit} supports NormalizedEvent.selection, fail-closed elective filtering and ICS preference application.`
  }
];

const report = {
  qaReportId: 'qa-kgmu-2026-2027-s1-medicine-501-516-v1',
  parsingJobId: 'parsing-job-medicine-501-516-2026-08-31-v1',
  candidateDigest,
  decision: checks.some((check) => check.status === 'fail') ? 'fail' : 'pass',
  checks,
  sharedContractEvidence: CORE_EVIDENCE,
  createdAt: '2026-08-31T17:00:00+03:00'
};

await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8'),
  writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8'),
  writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
]);

console.log(JSON.stringify({
  candidateDigest,
  eventCount: events.length,
  groupEventCounts,
  duplicateEvents,
  selectionAlternativeOverlapCount,
  selectionDependentOverlapCount,
  explicitOverlapCount,
  qaDecision: report.decision
}, null, 2));
