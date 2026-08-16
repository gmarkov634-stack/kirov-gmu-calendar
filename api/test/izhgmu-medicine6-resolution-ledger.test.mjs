import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateIzhgmuMedicine6ResolutionProposal } from '../src/adapters/izhgmu/medicine6-resolution-execution.mjs';
import {
  authorizeIzhgmuMedicine6ResolutionCandidate,
  prepareIzhgmuMedicine6ResolutionAuthorizationTarget,
  validateIzhgmuMedicine6ResolutionLedger,
} from '../src/adapters/izhgmu/medicine6-resolution-ledger.mjs';

const SOURCE_HASH = 'a'.repeat(64);
const CHOICE_HASH = 'b'.repeat(64);

function readyOfficial() {
  return evaluateIzhgmuMedicine6ResolutionProposal(
    {
      source_component: 'postsemester',
      warning: 'end_time_missing_in_source',
      component: 'Государственный экзамен',
      group: '601',
    },
    {
      kind: 'official_source_evidence',
      source: {
        fileName: 'gia-reviewed.pdf',
        url: 'https://www.igma.ru/reviewed/gia.pdf',
        sha256: SOURCE_HASH,
        references: ['page:1/state-exam'],
      },
      proposedFact: { endTime: '12:00' },
      reviewed: true,
      reviewReference: 'review:izhgmu:g6:gia:2026-08-16',
    },
  );
}

function readyChoice() {
  return evaluateIzhgmuMedicine6ResolutionProposal(
    {
      source_component: 'cycle',
      warning: 'elective_choice_required',
      discipline: 'Дисциплина по выбору 4',
      group: '601',
    },
    {
      kind: 'student_choice',
      explicit: true,
      group: '601',
      choiceReference: 'choice:student-opaque-id:dv4',
      choices: [{
        slot: 4,
        alternative: 'Вариант ДВ4',
        sourceFile: 'medicine6.xlsx',
        sourceHash: CHOICE_HASH,
        sourceReference: 'sheet:lectures/dv4',
      }],
    },
  );
}

function authorizationFor(evaluatedProposal, overrides = {}) {
  const target = prepareIzhgmuMedicine6ResolutionAuthorizationTarget(evaluatedProposal);
  return {
    explicit: true,
    authorizedBy: 'operator:reviewed',
    authorizationReference: 'approval:izhgmu:3p:001',
    authorizedAt: '2026-08-16T05:30:00Z',
    expectedBlockerFingerprint: target.blockerFingerprint,
    expectedCandidateFingerprint: target.candidateFingerprint,
    ...overrides,
  };
}

test('3P authorization target fingerprints blocker and candidate without mutating proposal', () => {
  const proposal = readyOfficial();
  const before = structuredClone(proposal);
  const target = prepareIzhgmuMedicine6ResolutionAuthorizationTarget(proposal);
  assert.match(target.blockerFingerprint, /^[a-f0-9]{64}$/);
  assert.match(target.candidateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(target.productionSemantics, 'authorization_target_only_no_schedule_mutation');
  assert.deepEqual(proposal, before);
});

test('3P explicit authorization creates immutable non-materialized record', () => {
  const proposal = readyOfficial();
  const result = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: proposal,
    authorization: authorizationFor(proposal),
  });
  assert.equal(result.status, 'authorized');
  assert.equal(result.idempotent, false);
  assert.equal(result.clearsBlocker, false);
  assert.equal(result.mutatesSchedule, false);
  assert.equal(result.publishable, false);
  assert.equal(result.record.status, 'authorized_not_materialized');
  assert.match(result.record.resolutionId, /^izhgmu-m6:[a-f0-9]{64}$/);
  assert.match(result.record.resolutionFingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.record.recordFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.record.nextRequiredBoundary, 'component_specific_rematerialization_and_full_qa');
});

test('3P exact retry is idempotent', () => {
  const proposal = readyOfficial();
  const authorization = authorizationFor(proposal);
  const first = authorizeIzhgmuMedicine6ResolutionCandidate({ evaluatedProposal: proposal, authorization });
  const second = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: proposal,
    authorization,
    existingRecords: [first.record],
  });
  assert.equal(second.status, 'already_authorized');
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.record, first.record);
});

test('3P same blocker+candidate cannot be re-authorized under a different authorization record', () => {
  const proposal = readyOfficial();
  const firstAuthorization = authorizationFor(proposal);
  const first = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: proposal,
    authorization: firstAuthorization,
  });
  assert.throws(
    () => authorizeIzhgmuMedicine6ResolutionCandidate({
      evaluatedProposal: proposal,
      authorization: authorizationFor(proposal, {
        authorizationReference: 'approval:izhgmu:3p:002',
        authorizedAt: '2026-08-16T05:31:00Z',
      }),
      existingRecords: [first.record],
    }),
    /IZH_M6_RESOLUTION_LEDGER_IMMUTABILITY_VIOLATION/,
  );
});

test('3P stale blocker authorization is rejected', () => {
  const proposal = readyOfficial();
  assert.throws(
    () => authorizeIzhgmuMedicine6ResolutionCandidate({
      evaluatedProposal: proposal,
      authorization: authorizationFor(proposal, { expectedBlockerFingerprint: 'c'.repeat(64) }),
    }),
    /IZH_M6_RESOLUTION_STALE_BLOCKER/,
  );
});

test('3P candidate mismatch authorization is rejected', () => {
  const proposal = readyOfficial();
  assert.throws(
    () => authorizeIzhgmuMedicine6ResolutionCandidate({
      evaluatedProposal: proposal,
      authorization: authorizationFor(proposal, { expectedCandidateFingerprint: 'd'.repeat(64) }),
    }),
    /IZH_M6_RESOLUTION_CANDIDATE_MISMATCH/,
  );
});

test('3P cannot authorize an unreviewed 3O candidate', () => {
  const unready = evaluateIzhgmuMedicine6ResolutionProposal(
    {
      source_component: 'postsemester',
      warning: 'end_time_missing_in_source',
      component: 'Государственный экзамен',
      group: '601',
    },
    {
      kind: 'official_source_evidence',
      source: {
        fileName: 'gia-new.pdf',
        url: 'https://www.igma.ru/new/gia.pdf',
        sha256: SOURCE_HASH,
        references: ['page:1'],
      },
      proposedFact: { endTime: '12:00' },
      reviewed: false,
    },
  );
  assert.equal(unready.status, 'review_required');
  assert.throws(
    () => prepareIzhgmuMedicine6ResolutionAuthorizationTarget(unready),
    /IZH_M6_RESOLUTION_CANDIDATE_NOT_READY/,
  );
});

test('3P student-choice candidate uses the same authorization/ledger boundary', () => {
  const proposal = readyChoice();
  const result = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: proposal,
    authorization: authorizationFor(proposal, {
      authorizationReference: 'approval:izhgmu:student-choice:opaque:001',
    }),
  });
  assert.equal(result.status, 'authorized');
  assert.equal(result.record.resolutionClass, 'student_choice_required');
  assert.equal(result.record.sourceComponent, 'cycle');
  assert.equal(result.record.candidate.group, '601');
  assert.equal(result.record.mutatesSchedule, false);
});

test('3P ledger validator rejects duplicate resolution identity and materializing flags', () => {
  const proposal = readyOfficial();
  const first = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: proposal,
    authorization: authorizationFor(proposal),
  });
  const good = validateIzhgmuMedicine6ResolutionLedger([first.record]);
  assert.equal(good.status, 'ok');
  assert.equal(good.recordCount, 1);

  const duplicate = validateIzhgmuMedicine6ResolutionLedger([first.record, structuredClone(first.record)]);
  assert.equal(duplicate.status, 'error');
  assert.ok(duplicate.errors.some((item) => item.code === 'duplicate_resolution_id'));

  const unsafe = structuredClone(first.record);
  unsafe.mutatesSchedule = true;
  const unsafeResult = validateIzhgmuMedicine6ResolutionLedger([unsafe]);
  assert.equal(unsafeResult.status, 'error');
  assert.ok(unsafeResult.errors.some((item) => item.code === 'ledger_record_must_not_materialize_or_publish'));
});

test('3P authorization itself is fail-closed on missing explicit approval and invalid timestamp', () => {
  const proposal = readyOfficial();
  assert.throws(
    () => authorizeIzhgmuMedicine6ResolutionCandidate({
      evaluatedProposal: proposal,
      authorization: authorizationFor(proposal, { explicit: false }),
    }),
    /IZH_M6_RESOLUTION_EXPLICIT_AUTHORIZATION_REQUIRED/,
  );
  assert.throws(
    () => authorizeIzhgmuMedicine6ResolutionCandidate({
      evaluatedProposal: proposal,
      authorization: authorizationFor(proposal, { authorizedAt: '2026-08-16' }),
    }),
    /IZH_M6_RESOLUTION_AUTHORIZED_AT_INVALID/,
  );
});
