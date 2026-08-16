import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIzhgmuCycleQaCandidate } from '../src/adapters/izhgmu/cycle-canonical.mjs';
import { executeIzhgmuMedicine6CycleElectiveRematerialization } from '../src/adapters/izhgmu/medicine6-cycle-elective-rematerializer.mjs';
import { acceptIzhgmuMedicine6RematerializationResult } from '../src/adapters/izhgmu/medicine6-resolution-acceptance.mjs';
import { evaluateIzhgmuMedicine6ResolutionProposal } from '../src/adapters/izhgmu/medicine6-resolution-execution.mjs';
import {
  authorizeIzhgmuMedicine6ResolutionCandidate,
  prepareIzhgmuMedicine6ResolutionAuthorizationTarget,
} from '../src/adapters/izhgmu/medicine6-resolution-ledger.mjs';
import { prepareIzhgmuMedicine6RematerializationPlan } from '../src/adapters/izhgmu/medicine6-resolution-rematerialization.mjs';

const FILE = '25_medicine_course-6_class_ru.xlsx';
const HASH = '3e7049eb182e13c45bfac757630594a928cd094d04d2f03698023487065f669a';

function baseSeries() {
  return {
    sourceRole: 'class',
    sourceSheet: 'практич.занятия',
    group: '601',
    sourceGroupSpan: '601-602',
    discipline: 'Эпидемиология',
    disciplineRaw: 'Эпидемиолог',
    lessonType: { raw: 'практические занятия', code: 'practice' },
    dates: ['2026-02-02'],
    startTime: '08:00',
    endTime: '12:05',
    sourceTimeSlots: [{ start: '08:00', end: '12:05' }],
    department: 'Кафедра эпидемиологии',
    assessment: 'зачет',
    location: 'SYNTHETIC ROOM',
    jointGroups: ['602'],
    status: 'ok',
    warning: null,
    warnings: [],
    ruleIds: ['IZH-C14'],
    references: [{ role: 'discipline', range: 'практич.занятия!B6' }],
    rawSource: 'Эпидемиолог | SYNTHETIC',
  };
}

function electiveChoice(slot, discipline, alternative) {
  return {
    slot,
    discipline,
    disciplineRaw: `Дисвб${slot}`,
    dates: [
      '2026-04-20', '2026-04-21', '2026-04-22',
      '2026-04-23', '2026-04-24', '2026-04-25',
    ],
    startTime: '08:00',
    endTime: '12:05',
    sourceTimeSlots: [{ start: '08:00', end: '12:05' }],
    assessment: 'зачет',
    alternatives: [{
      discipline: alternative,
      department: `Кафедра ${alternative}`,
      location: `Аудитория ДВ${slot}`,
      reference: `практич.занятия!OPT${slot}`,
    }],
    reference: `практич.занятия!DV${slot}`,
    sectionReference: `практич.занятия!SECTION${slot}`,
  };
}

function review(slot, discipline, alternative) {
  return {
    sourceRole: 'class',
    sourceSheet: 'практич.занятия',
    group: '601',
    discipline,
    disciplineRaw: `Дисвб${slot}`,
    dates: electiveChoice(slot, discipline, alternative).dates,
    startTime: '08:00',
    endTime: '12:05',
    status: 'needs_review',
    warning: 'elective_choice_required',
    warnings: ['elective_choice_required'],
    electiveSlot: slot,
    options: [alternative],
    ruleIds: ['IZH-C17', 'IZH-C18'],
    references: [
      { role: 'discipline', range: `практич.занятия!DV${slot}` },
      { role: 'note', range: `практич.занятия!SECTION${slot}` },
    ],
  };
}

function parsedCycle() {
  const dv4 = electiveChoice(4, 'Дисциплина по выбору 4', 'SYNTHETIC ДВ4 — клиническая логика');
  const dv5 = electiveChoice(5, 'Дисциплина по выбору 5', 'SYNTHETIC ДВ5 — профилактика');
  return {
    profile: 'IZH-CYCLE',
    sourceProfile: 'IZH-CYCLE-MEDICINE6',
    sourceSheet: 'практич.занятия',
    group: '601',
    sourceGroupSpan: '601-602',
    period: {
      start_date: '2026-02-02',
      end_date: '2026-05-30',
      week1_start_date: '2026-02-02',
    },
    series: [baseSeries()],
    electiveChoices: [dv4, dv5],
    reviewRequired: [
      review(4, dv4.discipline, dv4.alternatives[0].discipline),
      review(5, dv5.discipline, dv5.alternatives[0].discipline),
    ],
    publishable: false,
  };
}

function component() {
  return {
    parsed: parsedCycle(),
    metadata: {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 6,
      groupCode: '601',
      stream: null,
    },
    source: { fileName: FILE, fileHash: HASH },
  };
}

function blockers() {
  return [
    {
      kind: 'series_review',
      warning: 'elective_choice_required',
      reference: 'практич.занятия!DV4',
      discipline: 'Дисциплина по выбору 4',
      source_component: 'cycle',
    },
    {
      kind: 'series_review',
      warning: 'elective_choice_required',
      reference: 'практич.занятия!DV5',
      discipline: 'Дисциплина по выбору 5',
      source_component: 'cycle',
    },
    {
      warning: 'stream_group_mapping_required',
      streams: [1, 2],
      source_component: 'lecture',
    },
  ];
}

function planFixture() {
  const beforeBlockers = blockers();
  const targetBlocker = beforeBlockers[0];
  const evaluated = evaluateIzhgmuMedicine6ResolutionProposal(targetBlocker, {
    kind: 'student_choice',
    explicit: true,
    group: '601',
    choiceReference: 'student:601:dv4:synthetic',
    choices: [{
      slot: 4,
      alternative: 'SYNTHETIC ДВ4 — клиническая логика',
      sourceFile: FILE,
      sourceHash: HASH,
      sourceReference: 'практич.занятия!OPT4',
    }],
  });
  assert.equal(evaluated.status, 'ready_for_explicit_apply');
  const target = prepareIzhgmuMedicine6ResolutionAuthorizationTarget(evaluated);
  const record = authorizeIzhgmuMedicine6ResolutionCandidate({
    evaluatedProposal: evaluated,
    authorization: {
      explicit: true,
      authorizedBy: 'student:601',
      authorizationReference: 'student-choice-authorization:601:dv4',
      authorizedAt: '2026-08-16T08:30:00Z',
      expectedBlockerFingerprint: target.blockerFingerprint,
      expectedCandidateFingerprint: target.candidateFingerprint,
    },
  }).record;
  const plan = prepareIzhgmuMedicine6RematerializationPlan({
    record,
    currentBlocker: targetBlocker,
    currentGroup: '601',
    availableSources: [{ fileName: FILE, sha256: HASH, role: 'cycle-source' }],
  });
  return { plan, targetBlocker, beforeBlockers };
}

function executeFixture() {
  const c = component();
  const p = planFixture();
  const beforeBatch = buildIzhgmuCycleQaCandidate(c);
  const result = executeIzhgmuMedicine6CycleElectiveRematerialization({
    plan: p.plan,
    component: c,
    beforeBlockers: p.beforeBlockers,
  });
  return { component: c, beforeBatch, ...p, result };
}

test('3T rematerializes one cycle elective from exact source slot without persistent mutation', () => {
  const value = executeFixture();
  assert.equal(value.result.schema, 'izhgmu-medicine6-rematerialization-result/v1');
  assert.equal(value.result.targetAdapter, 'cycle-medicine6');
  assert.equal(value.result.afterBatch.events.length, value.beforeBatch.events.length + 6);
  assert.equal(value.result.afterBlockers.length, value.beforeBlockers.length - 1);
  assert.equal(value.result.afterBlockers.some((item) => item.discipline === 'Дисциплина по выбору 4'), false);
  assert.equal(value.result.afterBlockers.some((item) => item.discipline === 'Дисциплина по выбору 5'), true);
  assert.equal(value.result.resolvedSeries.discipline, 'SYNTHETIC ДВ4 — клиническая логика');
  assert.deepEqual(value.result.resolvedSeries.dates, value.component.parsed.electiveChoices[0].dates);
  assert.equal(value.result.resolvedSeries.startTime, '08:00');
  assert.equal(value.result.resolvedSeries.endTime, '12:05');
  assert.equal(value.result.resolvedSeries.location, 'Аудитория ДВ4');
  assert.deepEqual(value.result.resolvedSeries.jointGroups, ['602']);
  assert.equal(value.result.eventDelta.added.length, 6);
  assert.deepEqual(value.result.eventDelta.removed, []);
  assert.equal(value.result.clearsPersistentBlocker, false);
  assert.equal(value.result.mutatesPersistentSchedule, false);
  assert.equal(value.result.persistentWriteAllowed, false);
  assert.equal(value.result.publicationAllowed, false);
  assert.equal(value.result.productionApplied, false);
});

test('3T output passes the existing 3R acceptance boundary without a parallel result format', () => {
  const value = executeFixture();
  let counter = 0;
  const acceptance = acceptIzhgmuMedicine6RematerializationResult({
    plan: value.plan,
    beforeBatch: value.beforeBatch,
    beforeBlockers: value.beforeBlockers,
    result: value.result,
    publicationOptions: {
      now: '2026-08-16T08:35:00Z',
      eventIdFactory: () => `evt_3t_${++counter}`,
      versionIdFactory: () => 'ver_3t',
    },
  });
  assert.equal(acceptance.status, 'qa_accepted_not_published');
  assert.equal(acceptance.targetBlockerRemovedInCandidateState, true);
  assert.equal(acceptance.sharedQa.inputPublishable, true);
  assert.equal(acceptance.sharedQa.outputPublishable, true);
  assert.ok(acceptance.sharedQa.icsBytes > 0);
  assert.equal(acceptance.clearsBlocker, false);
  assert.equal(acceptance.publishable, false);
});

test('3T refuses a chosen elective alternative absent from the exact parsed source', () => {
  const value = planFixture();
  value.plan.candidate.choices[0].alternative = 'НЕСУЩЕСТВУЮЩИЙ ДВ';
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: component(),
      beforeBlockers: value.beforeBlockers,
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_ALTERNATIVE_NOT_SOURCE_BOUND',
  );
});

test('3T refuses source SHA drift even when filename and slot still match', () => {
  const value = planFixture();
  const changed = component();
  changed.source.fileHash = 'f'.repeat(64);
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: changed,
      beforeBlockers: value.beforeBlockers,
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_SOURCE_BINDING_MISMATCH',
  );
});

test('3T refuses a stale target blocker before changing candidate state', () => {
  const value = planFixture();
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: component(),
      beforeBlockers: value.beforeBlockers.slice(1),
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_TARGET_BLOCKER_STALE',
  );
});

test('3T refuses ambiguous duplicate source alternatives', () => {
  const value = planFixture();
  const changed = component();
  changed.parsed.electiveChoices[0].alternatives.push(structuredClone(changed.parsed.electiveChoices[0].alternatives[0]));
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: changed,
      beforeBlockers: value.beforeBlockers,
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_ALTERNATIVE_NOT_SOURCE_BOUND',
  );
});

test('3T refuses a plan routed to another component adapter', () => {
  const value = planFixture();
  value.plan.targetAdapter = 'lecture-medicine6';
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: component(),
      beforeBlockers: value.beforeBlockers,
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_ROUTE_MISMATCH',
  );
});

test('3T refuses multi-slot mutation through the single cycle-blocker executor', () => {
  const value = planFixture();
  value.plan.candidate.choices.push({
    slot: 5,
    alternative: 'SYNTHETIC ДВ5 — профилактика',
    sourceFile: FILE,
    sourceHash: HASH,
    sourceReference: 'практич.занятия!OPT5',
  });
  assert.throws(
    () => executeIzhgmuMedicine6CycleElectiveRematerialization({
      plan: value.plan,
      component: component(),
      beforeBlockers: value.beforeBlockers,
    }),
    (error) => error?.code === 'IZH_M6_CYCLE_REMATERIALIZER_SINGLE_SLOT_REQUIRED',
  );
});

test('3T does not mutate the plan, component source state, or blocker list', () => {
  const value = planFixture();
  const c = component();
  const beforePlan = structuredClone(value.plan);
  const beforeComponent = structuredClone(c);
  const beforeBlockers = structuredClone(value.beforeBlockers);
  executeIzhgmuMedicine6CycleElectiveRematerialization({
    plan: value.plan,
    component: c,
    beforeBlockers: value.beforeBlockers,
  });
  assert.deepEqual(value.plan, beforePlan);
  assert.deepEqual(c, beforeComponent);
  assert.deepEqual(value.beforeBlockers, beforeBlockers);
});
