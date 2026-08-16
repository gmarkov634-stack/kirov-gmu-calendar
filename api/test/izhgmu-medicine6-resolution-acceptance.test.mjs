import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIzhgmuCycleQaCandidate } from '../src/adapters/izhgmu/cycle-canonical.mjs';
import { evaluateIzhgmuMedicine6ResolutionProposal } from '../src/adapters/izhgmu/medicine6-resolution-execution.mjs';
import {
  authorizeIzhgmuMedicine6ResolutionCandidate,
  prepareIzhgmuMedicine6ResolutionAuthorizationTarget,
} from '../src/adapters/izhgmu/medicine6-resolution-ledger.mjs';
import { prepareIzhgmuMedicine6RematerializationPlan } from '../src/adapters/izhgmu/medicine6-resolution-rematerialization.mjs';
import {
  acceptIzhgmuMedicine6RematerializationResult,
  fingerprintIzhgmuMedicine6RematerializationEvent,
} from '../src/adapters/izhgmu/medicine6-resolution-acceptance.mjs';

const SOURCE_FILE = 'SYNTHETIC-medicine6-cycle.xlsx';
const SOURCE_HASH = 'b'.repeat(64);

function hasErrorCode(code) {
  return (error) => error?.code === code;
}

function series({ discipline, date, startTime, endTime, range }) {
  return {
    discipline,
    lessonType: { raw: 'практические занятия', code: 'practice' },
    startTime,
    endTime,
    dates: [date],
    location: 'SYNTHETIC ROOM',
    assessment: null,
    sourceSheet: 'SYNTHETIC',
    references: [
      { role: 'discipline', range },
      { role: 'date', range },
      { role: 'time', range },
    ],
    rawSource: `SYNTHETIC ${discipline}`,
    jointGroups: [],
    status: 'ok',
    ruleIds: ['IZH-SYNTHETIC-3R'],
    warnings: [],
  };
}

function batchWithSeries(items) {
  return buildIzhgmuCycleQaCandidate({
    parsed: {
      profile: 'IZH-CYCLE',
      group: '601',
      period: {
        start_date: '2026-02-02',
        end_date: '2026-06-22',
        week1_start_date: '2026-02-02',
      },
      series: items,
      reviewRequired: [],
      publishable: true,
    },
    metadata: {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 6,
      groupCode: '601',
      stream: null,
    },
    source: { fileName: SOURCE_FILE, fileHash: SOURCE_HASH },
  });
}

function resolutionFixture() {
  const targetBlocker = {
    source_component: 'cycle',
    warning: 'elective_choice_required',
    discipline: 'Дисциплина по выбору 4',
    group: '601',
  };
  const unrelatedBlocker = {
    source_component: 'lecture',
    warning: 'stream_group_mapping_required',
    streams: [1, 2],
  };
  const evaluated = evaluateIzhgmuMedicine6ResolutionProposal(targetBlocker, {
    kind: 'student_choice',
    explicit: true,
    group: '601',
    choiceReference: 'SYNTHETIC-choice:601:dv4',
    choices: [{
      slot: 4,
      alternative: 'SYNTHETIC elective option',
      sourceFile: SOURCE_FILE,
      sourceHash: SOURCE_HASH,
      sourceReference: 'SYNTHETIC!DV4',
    }],
  });
  const authTarget = prepareIzhgmuMedicine6ResolutionAuthorizationTarget(evaluated);
  const record = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: evaluated,
    authorization: {
      explicit: true,
      authorizedBy: 'operator:SYNTHETIC',
      authorizationReference: 'SYNTHETIC-approval:3R:001',
      authorizedAt: '2026-08-16T06:10:00Z',
      expectedBlockerFingerprint: authTarget.blockerFingerprint,
      expectedCandidateFingerprint: authTarget.candidateFingerprint,
    },
  }).record;
  const plan = prepareIzhgmuMedicine6RematerializationPlan({
    record,
    currentBlocker: targetBlocker,
    currentGroup: '601',
    availableSources: [{ fileName: SOURCE_FILE, sha256: SOURCE_HASH, role: 'cycle-source' }],
  });
  return { targetBlocker, unrelatedBlocker, plan };
}

function batches() {
  const baseSeries = series({
    discipline: 'SYNTHETIC baseline discipline',
    date: '2026-02-03',
    startTime: '08:00',
    endTime: '09:30',
    range: 'SYNTHETIC!A1',
  });
  const resolvedSeries = series({
    discipline: 'SYNTHETIC elective option',
    date: '2026-02-04',
    startTime: '10:00',
    endTime: '11:30',
    range: 'SYNTHETIC!A2',
  });
  return {
    beforeBatch: batchWithSeries([baseSeries]),
    afterBatch: batchWithSeries([baseSeries, resolvedSeries]),
  };
}

function resultFor({ plan, afterBatch, afterBlockers, beforeBatch }) {
  const beforeFingerprints = new Set(beforeBatch.events.map(fingerprintIzhgmuMedicine6RematerializationEvent));
  const added = afterBatch.events
    .map(fingerprintIzhgmuMedicine6RematerializationEvent)
    .filter((value) => !beforeFingerprints.has(value));
  return {
    schema: 'izhgmu-medicine6-rematerialization-result/v1',
    resolutionId: plan.resolutionId,
    resolutionFingerprint: plan.resolutionFingerprint,
    blockerFingerprint: plan.blockerFingerprint,
    candidateFingerprint: plan.candidateFingerprint,
    group: plan.group,
    targetAdapter: plan.targetAdapter,
    afterBatch,
    afterBlockers,
    eventDelta: { added, removed: [] },
  };
}

function acceptedFixture() {
  const resolution = resolutionFixture();
  const { beforeBatch, afterBatch } = batches();
  const beforeBlockers = [resolution.targetBlocker, resolution.unrelatedBlocker];
  const afterBlockers = [resolution.unrelatedBlocker];
  const result = resultFor({ plan: resolution.plan, beforeBatch, afterBatch, afterBlockers });
  return { ...resolution, beforeBatch, afterBatch, beforeBlockers, afterBlockers, result };
}

test('3R accepts only QA-valid synthetic rematerialized candidate and still does not publish', () => {
  const fixture = acceptedFixture();
  const acceptance = acceptIzhgmuMedicine6RematerializationResult({
    plan: fixture.plan,
    beforeBatch: fixture.beforeBatch,
    beforeBlockers: fixture.beforeBlockers,
    result: fixture.result,
    publicationOptions: { now: '2026-08-16T06:15:00Z' },
  });
  assert.equal(acceptance.status, 'qa_accepted_not_published');
  assert.equal(acceptance.targetBlockerRemovedInCandidateState, true);
  assert.equal(acceptance.sharedQa.inputPublishable, true);
  assert.equal(acceptance.sharedQa.outputPublishable, true);
  assert.ok(acceptance.sharedQa.icsBytes > 0);
  assert.equal(acceptance.clearsBlocker, false);
  assert.equal(acceptance.mutatesSchedule, false);
  assert.equal(acceptance.productionApplied, false);
  assert.equal(acceptance.publishable, false);
  assert.equal(acceptance.nextRequiredBoundary, 'full_composite_rebuild_and_publication_qa');
});

test('3R rejects hidden event change when declared delta is incomplete', () => {
  const fixture = acceptedFixture();
  const tampered = structuredClone(fixture.result);
  tampered.afterBatch.events[0].lesson.discipline.normalized = 'SYNTHETIC hidden change';
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    hasErrorCode('IZH_M6_REMATERIALIZATION_EVENT_DELTA_MISMATCH'),
  );
});

test('3R rejects removal of any unrelated blocker', () => {
  const fixture = acceptedFixture();
  const tampered = structuredClone(fixture.result);
  tampered.afterBlockers = [];
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    /IZH_M6_REMATERIALIZATION_UNRELATED_BLOCKERS_CHANGED/,
  );
});

test('3R rejects a new unrelated blocker as well as an unrelated removal', () => {
  const fixture = acceptedFixture();
  const tampered = structuredClone(fixture.result);
  tampered.afterBlockers.push({ source_component: 'postsemester', warning: 'SYNTHETIC-new-warning' });
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    /IZH_M6_REMATERIALIZATION_UNRELATED_BLOCKERS_CHANGED/,
  );
});

test('3R rejects stale/mismatched result binding before QA', () => {
  const fixture = acceptedFixture();
  const tampered = { ...fixture.result, targetAdapter: 'lecture-medicine6' };
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    hasErrorCode('IZH_M6_REMATERIALIZATION_RESULT_BINDING_MISMATCH'),
  );
});

test('3R rejects semantic duplicate even when provenance differs', () => {
  const fixture = acceptedFixture();
  const duplicate = structuredClone(fixture.result.afterBatch.events[0]);
  duplicate.source.file_name = 'SYNTHETIC-other-provenance.xlsx';
  duplicate.source.file_hash = 'c'.repeat(64);
  const tampered = structuredClone(fixture.result);
  tampered.afterBatch.events.push(duplicate);
  tampered.eventDelta.added.push(fingerprintIzhgmuMedicine6RematerializationEvent(duplicate));
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    hasErrorCode('IZH_M6_REMATERIALIZATION_SEMANTIC_DUPLICATE'),
  );
});

test('3R rejects schedule-context mutation', () => {
  const fixture = acceptedFixture();
  const tampered = structuredClone(fixture.result);
  tampered.afterBatch.schedule.group = '602';
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    hasErrorCode('IZH_M6_REMATERIALIZATION_CONTEXT_CHANGED'),
  );
});

test('3R shared publication QA remains authoritative', () => {
  const fixture = acceptedFixture();
  const tampered = structuredClone(fixture.result);
  tampered.afterBatch.events[1].timing.end_time = '09:00';
  tampered.eventDelta.added = [fingerprintIzhgmuMedicine6RematerializationEvent(tampered.afterBatch.events[1])];
  assert.throws(
    () => acceptIzhgmuMedicine6RematerializationResult({
      plan: fixture.plan,
      beforeBatch: fixture.beforeBatch,
      beforeBlockers: fixture.beforeBlockers,
      result: tampered,
    }),
    /Schedule input validation failed|SCHEDULE_NOT_PUBLISHABLE/,
  );
});

test('3R does not mutate plan, before state, or rematerializer result', () => {
  const fixture = acceptedFixture();
  const beforePlan = structuredClone(fixture.plan);
  const beforeBatch = structuredClone(fixture.beforeBatch);
  const beforeBlockers = structuredClone(fixture.beforeBlockers);
  const beforeResult = structuredClone(fixture.result);
  acceptIzhgmuMedicine6RematerializationResult({
    plan: fixture.plan,
    beforeBatch: fixture.beforeBatch,
    beforeBlockers: fixture.beforeBlockers,
    result: fixture.result,
    publicationOptions: { now: '2026-08-16T06:15:00Z' },
  });
  assert.deepEqual(fixture.plan, beforePlan);
  assert.deepEqual(fixture.beforeBatch, beforeBatch);
  assert.deepEqual(fixture.beforeBlockers, beforeBlockers);
  assert.deepEqual(fixture.result, beforeResult);
});
