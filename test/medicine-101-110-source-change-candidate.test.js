import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
} from '../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../src/medicine-publication-plan.js';

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

test('updated medicine 101-110 source produces a quarantined fresh normalized candidate', async () => {
  const [approvedManifest, facultatives, source, review, fullDiff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.normalization-review-2026-08-31.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.source-change-full-diff.json'),
  ]);

  assert.equal(review.publicationAllowed, false);
  assert.equal(review.qaState.qaDecision, 'pending');
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(fullDiff.semanticDecisionReuseAllowed, false);

  const changedCoords = [
    ...fullDiff.cellDiff.removed.map(({ coord }) => coord),
    ...fullDiff.cellDiff.added.map(({ coord }) => coord),
    ...fullDiff.cellDiff.changed.map(({ coord }) => coord),
  ];
  assert.ok(changedCoords.every((coord) => Number(coord.match(/\d+/)[0]) < 43));
  assert.deepEqual(fullDiff.mergedRangeDiff.removed, ['J34:K35']);

  const manifest = applyReviewedDelta(approvedManifest, review, source);
  const context = {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId,
  };
  const baseEvents = expandExplicitDecisionManifest(manifest, context);
  const facultativeEvents = expandMedicineFacultativeFixture(facultatives, context);
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
  };

  assert.equal(candidate.eventCount, review.expectedCandidate.eventCount);
  assert.equal(candidate.baseEventCount, review.expectedCandidate.baseEventCount);
  assert.equal(candidate.facultativeEventCount, review.expectedCandidate.facultativeEventCount);
  assert.deepEqual(candidate.groupEventCounts, review.expectedCandidate.groupEventCounts);
  assert.equal(candidate.duplicateEventSignatures, 0);

  assert.equal(events.some((event) => event.groupId === '109' && event.discipline === 'Правоведение' && event.sourceRef.locator === '1 леч.1!J26#s1'), false);
  assert.equal(events.some((event) => event.groupId === '110' && event.discipline === 'Правоведение' && event.sourceRef.locator === '1 леч.1!K26#s1'), false);
  assert.equal(events.some((event) => event.groupId === '110' && event.discipline === 'Экономика' && event.sourceRef.locator === '1 леч.1!J34#s1'), false);
  assert.ok(events.some((event) => event.groupId === '109' && event.discipline === 'Экономика' && event.sourceRef.locator === '1 леч.1!J35#s1'));
  assert.ok(events.some((event) => event.groupId === '109' && event.discipline === 'Анатомия' && event.startTime === '08:00' && event.endTime === '10:25' && event.sourceRef.locator === '1 леч.1!J34#s1'));
  assert.ok(events.some((event) => event.groupId === '110' && event.discipline === 'Анатомия' && event.startTime === '14:15' && event.endTime === '16:40' && event.sourceRef.locator === '1 леч.1!K37#s1'));

  const reviewedManifest = {
    ...manifest,
    candidateDigest: candidate.candidateDigest,
  };
  console.log(`SOURCE_CHANGE_CANDIDATE ${JSON.stringify(candidate)}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    await mkdir('.artifacts', { recursive: true });
    await Promise.all([
      writeFile(
        '.artifacts/medicine-101-110-source-change-candidate.json',
        `${JSON.stringify(candidate, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        '.artifacts/medicine-101-110-2026-08-31.decisions.json',
        `${JSON.stringify(reviewedManifest)}\n`,
        'utf8',
      ),
    ]);
  }
});
