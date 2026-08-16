import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateIzhgmuMedicine6ResolutionProposal } from '../src/adapters/izhgmu/medicine6-resolution-execution.mjs';
import {
  authorizeIzhgmuMedicine6ResolutionCandidate,
  prepareIzhgmuMedicine6ResolutionAuthorizationTarget,
} from '../src/adapters/izhgmu/medicine6-resolution-ledger.mjs';
import {
  prepareIzhgmuMedicine6RematerializationPlan,
  validateIzhgmuMedicine6RematerializationPlan,
} from '../src/adapters/izhgmu/medicine6-resolution-rematerialization.mjs';

const OFFICIAL_HASH = 'a'.repeat(64);
const CHOICE_HASH = 'b'.repeat(64);

function authorize(evaluatedProposal, reference = 'approval:3q:001') {
  const target = prepareIzhgmuMedicine6ResolutionAuthorizationTarget(evaluatedProposal);
  return authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal,
    authorization: {
      explicit: true,
      authorizedBy: 'operator:reviewed',
      authorizationReference: reference,
      authorizedAt: '2026-08-16T05:50:00Z',
      expectedBlockerFingerprint: target.blockerFingerprint,
      expectedCandidateFingerprint: target.candidateFingerprint,
    },
  }).record;
}

function officialFixture() {
  const blocker = {
    source_component: 'postsemester',
    warning: 'end_time_missing_in_source',
    component: 'Государственный экзамен',
    group: '601',
  };
  const evaluated = evaluateIzhgmuMedicine6ResolutionProposal(blocker, {
    kind: 'official_source_evidence',
    source: {
      fileName: 'gia-reviewed.pdf',
      url: 'https://www.igma.ru/reviewed/gia.pdf',
      sha256: OFFICIAL_HASH,
      references: ['page:1/state-exam'],
    },
    proposedFact: { endTime: '12:00' },
    reviewed: true,
    reviewReference: 'review:izhgmu:g6:gia:2026-08-16',
  });
  return { blocker, record: authorize(evaluated) };
}

function choiceFixture() {
  const blocker = {
    source_component: 'cycle',
    warning: 'elective_choice_required',
    discipline: 'Дисциплина по выбору 4',
    group: '601',
  };
  const evaluated = evaluateIzhgmuMedicine6ResolutionProposal(blocker, {
    kind: 'student_choice',
    explicit: true,
    group: '601',
    choiceReference: 'choice:opaque:601:dv4',
    choices: [{
      slot: 4,
      alternative: 'Вариант ДВ4',
      sourceFile: 'medicine6.xlsx',
      sourceHash: CHOICE_HASH,
      sourceReference: 'sheet:lectures/dv4',
    }],
  });
  return { blocker, record: authorize(evaluated, 'approval:3q:choice:001') };
}

test('3Q official-source record creates postsemester preflight without mutation', () => {
  const { blocker, record } = officialFixture();
  const plan = prepareIzhgmuMedicine6RematerializationPlan({
    record,
    currentBlocker: blocker,
    currentGroup: '601',
    availableSources: [{ fileName: 'gia-reviewed.pdf', sha256: OFFICIAL_HASH, url: 'https://www.igma.ru/reviewed/gia.pdf' }],
  });
  assert.equal(plan.status, 'preflight_ready');
  assert.equal(plan.targetAdapter, 'postsemester-medicine6');
  assert.equal(plan.group, '601');
  assert.equal(plan.clearsBlocker, false);
  assert.equal(plan.mutatesSchedule, false);
  assert.equal(plan.publishable, false);
  assert.equal(plan.requiresComponentRematerialization, true);
  assert.equal(validateIzhgmuMedicine6RematerializationPlan(plan).status, 'ok');
});

test('3Q explicit student choice routes only to cycle rematerializer and remains non-materializing', () => {
  const { blocker, record } = choiceFixture();
  const plan = prepareIzhgmuMedicine6RematerializationPlan({
    record,
    currentBlocker: blocker,
    currentGroup: '601',
    availableSources: [{ fileName: 'medicine6.xlsx', sha256: CHOICE_HASH, role: 'cycle-source' }],
  });
  assert.equal(plan.targetAdapter, 'cycle-medicine6');
  assert.equal(plan.candidateKind, 'student_choice');
  assert.equal(plan.candidateSources.length, 1);
  assert.equal(plan.nextRequiredBoundary, 'rematerialize:cycle-medicine6:then-full-qa');
  assert.equal(plan.mutatesSchedule, false);
});

test('3Q rejects stale current blocker even when ledger record itself is valid', () => {
  const { blocker, record } = officialFixture();
  const stale = { ...blocker, group: '602' };
  assert.throws(
    () => prepareIzhgmuMedicine6RematerializationPlan({
      record,
      currentBlocker: stale,
      currentGroup: '601',
      availableSources: [{ fileName: 'gia-reviewed.pdf', sha256: OFFICIAL_HASH }],
    }),
    /IZH_M6_REMATERIALIZATION_STALE_BLOCKER/,
  );
});

test('3Q rejects missing exact candidate source snapshot', () => {
  const { blocker, record } = officialFixture();
  assert.throws(
    () => prepareIzhgmuMedicine6RematerializationPlan({
      record,
      currentBlocker: blocker,
      currentGroup: '601',
      availableSources: [{ fileName: 'gia-reviewed.pdf', sha256: 'c'.repeat(64) }],
    }),
    /IZH_M6_REMATERIALIZATION_SOURCE_SNAPSHOT_MISSING/,
  );
});

test('3Q rejects group mismatch against blocker or candidate binding', () => {
  const { blocker, record } = choiceFixture();
  assert.throws(
    () => prepareIzhgmuMedicine6RematerializationPlan({
      record,
      currentBlocker: blocker,
      currentGroup: '602',
      availableSources: [{ fileName: 'medicine6.xlsx', sha256: CHOICE_HASH }],
    }),
    /IZH_M6_REMATERIALIZATION_BLOCKER_GROUP_MISMATCH/,
  );
});

test('3Q requires exact source references carried by authorized candidate', () => {
  const { blocker, record } = choiceFixture();
  const tampered = structuredClone(record);
  tampered.candidate.choices[0].sourceReference = '';
  assert.throws(
    () => prepareIzhgmuMedicine6RematerializationPlan({
      record: tampered,
      currentBlocker: blocker,
      currentGroup: '601',
      availableSources: [{ fileName: 'medicine6.xlsx', sha256: CHOICE_HASH }],
    }),
    /IZH_M6_REMATERIALIZATION_CANDIDATE_SOURCE_INVALID/,
  );
});

test('3Q plan validator rejects any attempt to claim materialization/publication', () => {
  const { blocker, record } = officialFixture();
  const plan = prepareIzhgmuMedicine6RematerializationPlan({
    record,
    currentBlocker: blocker,
    currentGroup: '601',
    availableSources: [{ fileName: 'gia-reviewed.pdf', sha256: OFFICIAL_HASH }],
  });
  const unsafe = { ...plan, mutatesSchedule: true, publishable: true };
  const validation = validateIzhgmuMedicine6RematerializationPlan(unsafe);
  assert.equal(validation.status, 'error');
  assert.ok(validation.errors.some((item) => item.code === 'preflight_must_not_materialize_or_publish'));
});

test('3Q does not mutate ledger record, blocker, or available-source inventory', () => {
  const fixture = officialFixture();
  const sources = [{ fileName: 'gia-reviewed.pdf', sha256: OFFICIAL_HASH }];
  const beforeRecord = structuredClone(fixture.record);
  const beforeBlocker = structuredClone(fixture.blocker);
  const beforeSources = structuredClone(sources);
  prepareIzhgmuMedicine6RematerializationPlan({
    record: fixture.record,
    currentBlocker: fixture.blocker,
    currentGroup: '601',
    availableSources: sources,
  });
  assert.deepEqual(fixture.record, beforeRecord);
  assert.deepEqual(fixture.blocker, beforeBlocker);
  assert.deepEqual(sources, beforeSources);
});
