import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
} from '../src/explicit-decisions.js';
import {
  buildMedicinePublicationPlan,
  expandMedicineFacultativeFixture,
} from '../src/medicine-publication-plan.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

const compareEvents = (a, b) => [
  Number(a.groupId) - Number(b.groupId),
  a.date.localeCompare(b.date),
  a.startTime.localeCompare(b.startTime),
  a.endTime.localeCompare(b.endTime),
  a.discipline.localeCompare(b.discipline),
  a.lessonType.localeCompare(b.lessonType),
  a.sourceRef.locator.localeCompare(b.sourceRef.locator),
].find((value) => value !== 0) ?? 0;

function tupleKey(tuple) {
  return JSON.stringify(tuple);
}

function applyReviewedDelta(approvedManifest, review, source) {
  assert.equal(approvedManifest.sourceSha256, review.approvedSourceSha256);
  assert.equal(source.source.sha256, review.sourceSha256);
  assert.equal(approvedManifest.parserRulesVersion, review.parserRulesVersion);

  const removeKeys = new Set(review.decisionDelta.removeExactTuples.map(tupleKey));
  for (const tuple of review.decisionDelta.removeExactTuples) {
    assert.equal(
      approvedManifest.decisions.filter((candidate) => tupleKey(candidate) === tupleKey(tuple)).length,
      1,
      `review removal must match exactly one approved tuple: ${tuple[0]}`,
    );
  }

  const retained = approvedManifest.decisions.filter((tuple) => !removeKeys.has(tupleKey(tuple)));
  const decisions = [...retained, ...review.decisionDelta.addTuples];
  assert.equal(decisions.length, review.decisionDelta.resultingDecisionCount);

  const { candidateDigest: _approvedDigest, ...manifestWithoutDigest } = approvedManifest;
  return {
    ...manifestWithoutDigest,
    fixtureId: source.fixtureId,
    sourceSha256: source.source.sha256,
    logicalSourceCellCount: review.decisionDelta.resultingLogicalSourceCellCount,
    decisionCount: decisions.length,
    decisions,
  };
}

test('updated medicine 101-110 source has a committed QA-pass candidate while publication stays fail-closed', async () => {
  const [
    approvedManifest,
    reviewedManifest,
    approvedFacultatives,
    reviewedFacultatives,
    source,
    parsingJob,
    review,
    evidence,
    qa,
    fullDiff,
  ] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.source.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.parsing-job.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.normalization-review-2026-08-31.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.candidate-evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.source-change-full-diff.json'),
  ]);

  assert.equal(review.publicationAllowed, false);
  assert.equal(review.qaState.qaDecision, 'pass');
  assert.equal(review.qaState.compatibilityGate, 'pending');
  assert.equal(review.qaState.scheduleVersionAllowed, false);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(fullDiff.semanticDecisionReuseAllowed, false);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, false);
  assert.equal(qa.compatibilityGate.status, 'pending');
  assert.equal(qa.sharedContractEvidence, null);

  const changedCoords = [
    ...fullDiff.cellDiff.removed.map(({ coord }) => coord),
    ...fullDiff.cellDiff.added.map(({ coord }) => coord),
    ...fullDiff.cellDiff.changed.map(({ coord }) => coord),
  ];
  assert.ok(changedCoords.every((coord) => Number(coord.match(/\d+/)[0]) < 43));
  assert.deepEqual(fullDiff.mergedRangeDiff.removed, ['J34:K35']);

  const derivedManifest = applyReviewedDelta(approvedManifest, review, source);
  assert.deepEqual(reviewedManifest, {
    ...derivedManifest,
    candidateDigest: review.expectedCandidate.candidateDigest,
  });

  const { sourceSha256: approvedFacultativeSha, ...approvedFacultativeContent } = approvedFacultatives;
  const { sourceSha256: reviewedFacultativeSha, ...reviewedFacultativeContent } = reviewedFacultatives;
  assert.equal(approvedFacultativeSha, review.approvedSourceSha256);
  assert.equal(reviewedFacultativeSha, source.source.sha256);
  assert.deepEqual(reviewedFacultativeContent, approvedFacultativeContent);

  assert.equal(parsingJob.jobId, qa.parsingJobId);
  assert.equal(parsingJob.universityId, source.universityId);
  assert.equal(parsingJob.academicPeriodId, source.academicPeriodId);
  assert.equal(parsingJob.sourceId, source.source.sourceId);
  assert.equal(parsingJob.parserRulesVersion, source.parserRulesVersion);
  assert.deepEqual(parsingJob.expectedGroupIds, source.expectedGroupIds);
  assert.ok(parsingJob.sourceObjectKey.endsWith(`/${source.source.sha256}.xlsx`));

  const context = {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId,
  };
  const baseEvents = expandExplicitDecisionManifest(reviewedManifest, context);
  const facultativeEvents = expandMedicineFacultativeFixture(reviewedFacultatives, context);
  const events = [...baseEvents, ...facultativeEvents].sort(compareEvents);

  const groupEventCounts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length,
  ]));

  const signatures = new Set();
  let duplicateEventSignatures = 0;
  for (const event of events) {
    const signature = [
      event.groupId,
      event.date,
      event.startTime,
      event.endTime,
      event.discipline,
      event.lessonType,
      event.location ?? '',
    ].join('|');
    if (signatures.has(signature)) duplicateEventSignatures += 1;
    signatures.add(signature);
  }

  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let overlapPairCount = 0;
  let overlapPairsInvolvingFacultatives = 0;
  for (const dayEvents of byDay.values()) {
    for (let left = 0; left < dayEvents.length; left += 1) {
      for (let right = left + 1; right < dayEvents.length; right += 1) {
        if (!overlaps(dayEvents[left], dayEvents[right])) continue;
        overlapPairCount += 1;
        if (dayEvents[left].facultativeId || dayEvents[right].facultativeId) {
          overlapPairsInvolvingFacultatives += 1;
        }
      }
    }
  }

  const candidate = {
    candidateDigest: digestNormalizedEvents(events),
    eventCount: events.length,
    baseEventCount: baseEvents.length,
    facultativeEventCount: facultativeEvents.length,
    groupEventCounts,
    duplicateEventSignatures,
    overlapPairCount,
    overlapPairsInvolvingFacultatives,
    baseOverlapPairCount: overlapPairCount - overlapPairsInvolvingFacultatives,
  };

  assert.deepEqual(candidate, {
    candidateDigest: evidence.candidateDigest,
    eventCount: evidence.eventCount,
    baseEventCount: evidence.baseEventCount,
    facultativeEventCount: evidence.facultativeEventCount,
    groupEventCounts: evidence.groupEventCounts,
    duplicateEventSignatures: evidence.duplicateEventSignatures,
    overlapPairCount: evidence.overlapPairCount,
    overlapPairsInvolvingFacultatives: evidence.overlapPairsInvolvingFacultatives,
    baseOverlapPairCount: evidence.baseOverlapPairCount,
  });
  assert.equal(candidate.candidateDigest, reviewedManifest.candidateDigest);
  assert.equal(candidate.candidateDigest, review.expectedCandidate.candidateDigest);
  assert.equal(candidate.candidateDigest, qa.candidateDigest);
  assert.equal(candidate.baseOverlapPairCount, evidence.approvedBaselineComparison.approvedBaseOverlapPairCount);
  assert.equal(candidate.duplicateEventSignatures, 0);

  assert.equal(events.some((event) => event.groupId === '109' && event.discipline === 'Правоведение' && event.sourceRef.locator === '1 леч.1!J26#s1'), false);
  assert.equal(events.some((event) => event.groupId === '110' && event.discipline === 'Правоведение' && event.sourceRef.locator === '1 леч.1!K26#s1'), false);
  assert.equal(events.some((event) => event.groupId === '110' && event.discipline === 'Экономика' && event.sourceRef.locator === '1 леч.1!J34#s1'), false);
  assert.ok(events.some((event) => event.groupId === '109' && event.discipline === 'Экономика' && event.sourceRef.locator === '1 леч.1!J35#s1'));
  assert.ok(events.some((event) => event.groupId === '109' && event.discipline === 'Анатомия' && event.startTime === '08:00' && event.endTime === '10:25' && event.sourceRef.locator === '1 леч.1!J34#s1'));
  assert.ok(events.some((event) => event.groupId === '110' && event.discipline === 'Анатомия' && event.startTime === '14:15' && event.endTime === '16:40' && event.sourceRef.locator === '1 леч.1!K37#s1'));

  assert.throws(
    () => buildMedicinePublicationPlan({
      manifest: reviewedManifest,
      facultatives: reviewedFacultatives,
      source,
      evidence,
      qa,
    }),
    /coreEvidence must be an object/,
  );
});
