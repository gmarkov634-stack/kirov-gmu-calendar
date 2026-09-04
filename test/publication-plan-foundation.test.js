import assert from 'node:assert/strict';
import test from 'node:test';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';
import { finalizePublicationPlan, toCorePublicationQa } from '../src/publication-plan-foundation.js';

function event(groupId, eventId, date) {
  return {
    eventId,
    universityId: 'kirov-gmu',
    groupId,
    academicPeriodId: '2026-2027-semester-1',
    date,
    startTime: '09:00',
    endTime: '10:00',
    timeSemantics: 'floating',
    discipline: 'Test',
    lessonType: 'practice',
    teacher: null,
    location: null,
    sourceRef: { sourceId: 'test-source', locator: `Sheet!${eventId}` }
  };
}

const events = [
  event('101', 'event-1', '2026-09-01'),
  event('102', 'event-2', '2026-09-02')
];
const candidateDigest = digestNormalizedEvents(events);
const source = {
  universityId: 'kirov-gmu',
  programId: 'medicine',
  academicYear: '2026-2027',
  academicPeriodId: '2026-2027-semester-1',
  expectedGroupIds: ['101', '102'],
  source: { sourceId: 'test-source', sha256: 'a'.repeat(64) }
};
const qa = {
  qaReportId: 'qa-1',
  parsingJobId: 'job-1',
  candidateDigest,
  decision: 'pass',
  checks: [{ code: 'complete', status: 'pass', message: 'ok' }],
  createdAt: '2026-09-04T00:00:00Z',
  sharedContractEvidence: { productionRuntimeCommit: 'b'.repeat(40) }
};
const evidence = {
  candidateDigest,
  eventCount: 2,
  groupEventCounts: { '101': 1, '102': 1 }
};

test('publication plan finalizer validates candidate parity and builds per-group descriptors', () => {
  const plan = finalizePublicationPlan({
    source,
    evidence,
    qa,
    events,
    versionIdFactory: ({ groupId }) => `version-${groupId}`,
    additionalFields: { programId: source.programId }
  });

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.programId, 'medicine');
  assert.equal(plan.candidateDigest, candidateDigest);
  assert.deepEqual(plan.versions, [
    { groupId: '101', versionId: 'version-101', eventCount: 1 },
    { groupId: '102', versionId: 'version-102', eventCount: 1 }
  ]);
  assert.deepEqual(plan.parsingResult, {
    jobId: 'job-1',
    universityId: 'kirov-gmu',
    academicPeriodId: '2026-2027-semester-1',
    events
  });
  assert.equal(Object.isFrozen(plan.events), true);
  assert.equal(Object.isFrozen(plan.versions), true);
});

test('publication plan finalizer fails closed on digest, group and version identity drift', () => {
  assert.throws(
    () => finalizePublicationPlan({
      source,
      evidence: { ...evidence, candidateDigest: `sha256:${'0'.repeat(64)}` },
      qa,
      events,
      versionIdFactory: ({ groupId }) => `version-${groupId}`
    }),
    /evidence\/QA candidate digest mismatch/
  );

  assert.throws(
    () => finalizePublicationPlan({
      source,
      evidence: { ...evidence, groupEventCounts: { '101': 2, '102': 0 } },
      qa,
      events,
      versionIdFactory: ({ groupId }) => `version-${groupId}`
    }),
    /group 101 event count does not match evidence/
  );

  assert.throws(
    () => finalizePublicationPlan({
      source,
      evidence,
      qa,
      events,
      versionIdFactory: () => 'duplicate-version'
    }),
    /duplicate versionId/
  );
});

test('publication QA projection strips university-only evidence and supports explicit createdAt', () => {
  assert.deepEqual(toCorePublicationQa(qa), {
    qaReportId: 'qa-1',
    parsingJobId: 'job-1',
    candidateDigest,
    decision: 'pass',
    checks: qa.checks,
    createdAt: '2026-09-04T00:00:00Z'
  });
  assert.equal(Object.hasOwn(toCorePublicationQa(qa), 'sharedContractEvidence'), false);
  assert.equal(
    toCorePublicationQa(qa, { createdAt: '2026-09-04T01:00:00Z' }).createdAt,
    '2026-09-04T01:00:00Z'
  );
});
