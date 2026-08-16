import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIzhgmuMedicine6ResolutionExecutionPlan,
  evaluateIzhgmuMedicine6ResolutionProposal,
} from '../src/adapters/izhgmu/medicine6-resolution-execution.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function officialBlocker(overrides = {}) {
  return {
    source_component: 'postsemester',
    warning: 'end_time_missing_in_source',
    component: 'Государственный экзамен',
    group: '601',
    ...overrides,
  };
}

function officialProposal(overrides = {}) {
  return {
    kind: 'official_source_evidence',
    source: {
      fileName: 'gia-update.pdf',
      url: 'https://www.igma.ru/example/gia-update.pdf',
      sha256: HASH_A,
      references: ['page:1/state-exam'],
    },
    proposedFact: { endTime: '12:00' },
    reviewed: false,
    ...overrides,
  };
}

function studentChoiceProposal({ group = '601', slots = [4] } = {}) {
  return {
    kind: 'student_choice',
    explicit: true,
    group,
    choiceReference: `choice:${group}`,
    choices: slots.map((slot) => ({
      slot,
      alternative: `Вариант ДВ${slot}`,
      sourceFile: 'medicine6.xlsx',
      sourceHash: HASH_B,
      sourceReference: `sheet:lectures/dv${slot}`,
    })),
  };
}

test('3O official-source arrival creates review candidate and never clears blocker', () => {
  const blocker = officialBlocker();
  const result = evaluateIzhgmuMedicine6ResolutionProposal(blocker, officialProposal());
  assert.equal(result.status, 'review_required');
  assert.equal(result.proposalAccepted, true);
  assert.equal(result.clearsBlocker, false);
  assert.equal(result.automaticApplyAllowed, false);
  assert.equal(result.requiresExplicitApply, false);
  assert.equal(result.reason, 'source_bound_semantic_review_required');
});

test('3O reviewed official evidence becomes explicit-apply candidate but still does not clear blocker', () => {
  const result = evaluateIzhgmuMedicine6ResolutionProposal(
    officialBlocker(),
    officialProposal({ reviewed: true, reviewReference: 'review:izhgmu:g6:gia:2026-08-16' }),
  );
  assert.equal(result.status, 'ready_for_explicit_apply');
  assert.equal(result.proposalAccepted, true);
  assert.equal(result.clearsBlocker, false);
  assert.equal(result.automaticApplyAllowed, false);
  assert.equal(result.requiresExplicitApply, true);
  assert.equal(result.candidate.source.sha256, HASH_A);
});

test('3O reviewed official evidence without review reference is rejected fail-closed', () => {
  const result = evaluateIzhgmuMedicine6ResolutionProposal(
    officialBlocker(),
    officialProposal({ reviewed: true }),
  );
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'review_reference_required_for_explicit_apply_candidate');
  assert.equal(result.clearsBlocker, false);
});

test('3O student choice must be explicit, source-bound and cover exact cycle elective slot', () => {
  const blocker = {
    source_component: 'cycle',
    warning: 'elective_choice_required',
    discipline: 'Дисциплина по выбору 4',
  };
  const result = evaluateIzhgmuMedicine6ResolutionProposal(blocker, studentChoiceProposal({ slots: [4] }));
  assert.equal(result.status, 'ready_for_explicit_apply');
  assert.equal(result.resolutionClass, 'student_choice_required');
  assert.equal(result.candidate.group, '601');
  assert.deepEqual(result.candidate.choices.map((item) => item.slot), [4]);
  assert.equal(result.clearsBlocker, false);
  assert.equal(result.automaticApplyAllowed, false);
});

test('3O aggregated lecture elective blocker requires choices for every source slot', () => {
  const blocker = {
    source_component: 'lecture',
    warning: 'elective_choice_required',
    slots: [4, 5],
    occurrences: 74,
  };
  const incomplete = evaluateIzhgmuMedicine6ResolutionProposal(blocker, studentChoiceProposal({ slots: [4] }));
  assert.equal(incomplete.status, 'rejected');
  assert.equal(incomplete.reason, 'student_choice_slot_coverage_mismatch');

  const complete = evaluateIzhgmuMedicine6ResolutionProposal(blocker, studentChoiceProposal({ slots: [4, 5] }));
  assert.equal(complete.status, 'ready_for_explicit_apply');
  assert.deepEqual(complete.candidate.choices.map((item) => item.slot), [4, 5]);
  assert.equal(complete.clearsBlocker, false);
});

test('3O never accepts official evidence as a substitute for a student choice', () => {
  const blocker = {
    source_component: 'cycle',
    warning: 'elective_choice_required',
    discipline: 'Дисциплина по выбору 5',
  };
  const result = evaluateIzhgmuMedicine6ResolutionProposal(blocker, officialProposal());
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'resolution_class_mismatch');
});

test('3O unknown blocker cannot enter proposal path without reviewed taxonomy rule', () => {
  const blocker = { source_component: 'lecture', warning: 'new_unknown_warning' };
  const result = evaluateIzhgmuMedicine6ResolutionProposal(blocker, officialProposal());
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'manual_review_required_for_unknown_blocker');
  assert.equal(result.clearsBlocker, false);
});

test('3O execution plan explicitly forbids automatic/evidence-arrival clearance', () => {
  const blockers = [
    { source_component: 'cycle', warning: 'elective_choice_required', discipline: 'Дисциплина по выбору 4' },
    { source_component: 'cycle', warning: 'elective_choice_required', discipline: 'Дисциплина по выбору 5' },
    { source_component: 'lecture', warning: 'elective_choice_required', slots: [4, 5] },
    { source_component: 'lecture', warning: 'stream_group_mapping_required', streams: [1, 2] },
    officialBlocker(),
  ];
  const before = structuredClone(blockers);
  const plan = buildIzhgmuMedicine6ResolutionExecutionPlan(blockers);
  assert.equal(plan.items.length, 5);
  assert.equal(plan.automaticClearCount, 0);
  assert.equal(plan.evidenceArrivalClearCount, 0);
  assert.equal(plan.explicitApplyRequiredCount, 5);
  assert.equal(plan.unknownCount, 0);
  assert.equal(plan.productionSemantics, 'proposal_only_no_blocker_clearance');
  assert.deepEqual(blockers, before);
});
