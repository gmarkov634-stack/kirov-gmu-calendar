import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIzhgmuMedicine6CompositeCandidate } from '../src/adapters/izhgmu/medicine6-composite.mjs';
import {
  fingerprintIzhgmuMedicine6RematerializationEvent,
} from '../src/adapters/izhgmu/medicine6-resolution-acceptance.mjs';
import {
  preflightIzhgmuMedicine6FullCompositeRebuild,
} from '../src/adapters/izhgmu/medicine6-resolution-composite-rebuild.mjs';
import {
  fingerprintIzhgmuMedicine6ResolutionBlocker,
} from '../src/adapters/izhgmu/medicine6-resolution-ledger.mjs';
import { IZHGMU_MEDICINE6_EXPECTED_GROUPS } from '../src/adapters/izhgmu/lecture-medicine6.mjs';

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

function cycleSeries({
  discipline = 'Эпидемиология',
  date = '2026-02-02',
  startTime = '08:00',
  endTime = '12:05',
  range = 'практич.занятия!B6',
} = {}) {
  return {
    sourceSheet: 'практич.занятия',
    discipline,
    lessonType: { raw: 'практические занятия', code: 'practice' },
    dates: [date],
    startTime,
    endTime,
    location: 'SYNTHETIC ROOM',
    assessment: null,
    jointGroups: [],
    status: 'ok',
    warnings: [],
    ruleIds: ['IZH-C14'],
    references: [{ role: 'discipline', range }],
    rawSource: `SYNTHETIC ${discipline}`,
  };
}

function cycleParsed(group, { resolveDv4 = false, hiddenEndTime = null, invalidResolvedTime = false } = {}) {
  const series = [cycleSeries({ endTime: hiddenEndTime || '12:05' })];
  if (resolveDv4) {
    series.push(cycleSeries({
      discipline: 'SYNTHETIC elective option',
      date: '2026-02-03',
      startTime: '10:00',
      endTime: invalidResolvedTime ? '09:00' : '11:30',
      range: 'практич.занятия!DV4',
    }));
  }
  const reviewRequired = [
    { discipline: 'Дисциплина по выбору 4', warning: 'elective_choice_required', references: [{ range: 'практич.занятия!A1' }] },
    { discipline: 'Дисциплина по выбору 5', warning: 'elective_choice_required', references: [{ range: 'практич.занятия!A2' }] },
  ];
  if (resolveDv4) reviewRequired.shift();
  return {
    profile: 'IZH-CYCLE',
    group,
    period: { start_date: '2026-02-02', end_date: '2026-05-30', week1_start_date: '2026-02-02' },
    series,
    reviewRequired,
    publishable: reviewRequired.length === 0,
  };
}

function lectureParsed({ removeElectiveBlocker = false } = {}) {
  const blockers = [
    { warning: 'stream_group_mapping_required', streams: [1, 2], occurrences: 6 },
    { warning: 'elective_choice_required', slots: [4, 5], occurrences: 74 },
  ];
  if (removeElectiveBlocker) blockers.pop();
  return {
    profile: 'IZH-LECTURE-MEDICINE6',
    period: { start_date: '2026-02-02', end_date: '2026-05-30', week1_start_date: '2026-02-02' },
    courseGroups: [...IZHGMU_MEDICINE6_EXPECTED_GROUPS],
    courseWideCoreSeries: [{
      sourceSheet: 'Лекции',
      discipline: 'Онкология',
      dates: ['2026-02-16'],
      startTime: '13:00',
      endTime: '14:35',
      location: 'ауд. 3',
      groups: [...IZHGMU_MEDICINE6_EXPECTED_GROUPS],
      status: 'ok',
      warnings: [],
      ruleIds: ['IZH-L6-01'],
      references: [{ role: 'discipline', range: 'Лекции!C10' }],
      rawSource: 'Онкология',
    }],
    reviewRequired: [],
    blockers,
    publishable: false,
  };
}

function compositeInput(group = '601', options = {}) {
  return {
    cycle: {
      parsed: cycleParsed(group, options),
      source: { fileName: '25_medicine_course-6_class_ru.xlsx', fileHash: '3e7049eb182e13c45bfac757630594a928cd094d04d2f03698023487065f669a' },
    },
    lecture: {
      parsed: lectureParsed(options),
      source: { fileName: '26_medicine_course-6_lecture_ru.xlsx', fileHash: 'e5dca93d81dbfbeeb2ecc09b47a3c40ad9eedbfee5f312eb431d38c299cec166' },
    },
    metadata: {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 6,
      groupCode: group,
      stream: null,
    },
  };
}

function eventDelta(beforeEvents, afterEvents) {
  const before = new Set(beforeEvents.map(fingerprintIzhgmuMedicine6RematerializationEvent));
  const after = new Set(afterEvents.map(fingerprintIzhgmuMedicine6RematerializationEvent));
  return {
    added: [...after].filter((value) => !before.has(value)).sort(),
    removed: [...before].filter((value) => !after.has(value)).sort(),
  };
}

function fixture(options = {}) {
  const baselineInput = compositeInput('601');
  const rebuiltInput = compositeInput('601', { resolveDv4: true, ...options });
  const baseline = buildIzhgmuMedicine6CompositeCandidate(baselineInput);
  const rebuilt = buildIzhgmuMedicine6CompositeCandidate(rebuiltInput);
  const targetBlocker = baseline.blockers.find((item) => item.source_component === 'cycle' && item.discipline === 'Дисциплина по выбору 4');
  assert.ok(targetBlocker);
  const acceptance = {
    schema: 'izhgmu-medicine6-rematerialization-acceptance/v1',
    status: 'qa_accepted_not_published',
    resolutionId: 'res_SYNTHETIC_dv4_601',
    resolutionFingerprint: FP_A,
    blockerFingerprint: fingerprintIzhgmuMedicine6ResolutionBlocker(targetBlocker),
    candidateFingerprint: FP_B,
    group: '601',
    targetAdapter: 'cycle-medicine6',
    eventDelta: eventDelta(baseline.batch.events, rebuilt.batch.events),
    beforeEventCount: baseline.batch.events.length,
    afterEventCount: rebuilt.batch.events.length,
    beforeBlockerCount: baseline.blockers.length,
    afterBlockerCount: rebuilt.blockers.length,
    targetBlockerRemovedInCandidateState: true,
    sharedQa: { inputPublishable: true, outputPublishable: true, icsBytes: 1234 },
    clearsBlocker: false,
    mutatesSchedule: false,
    productionApplied: false,
    publishable: false,
    requiresFullCompositeRebuild: true,
    requiresPublicationQa: true,
    nextRequiredBoundary: 'full_composite_rebuild_and_publication_qa',
    productionSemantics: 'qa_accepted_candidate_only_no_persistent_mutation',
  };
  return { baselineInput, rebuiltInput, baseline, rebuilt, acceptance };
}

function preflightArgs(value = fixture()) {
  let eventCounter = 0;
  return {
    baselineInput: value.baselineInput,
    rebuiltInput: value.rebuiltInput,
    acceptances: [value.acceptance],
    publicationOptions: {
      now: '2026-08-16T08:00:00Z',
      eventIdFactory: () => `evt_izh_m6_3s_${++eventCounter}`,
      versionIdFactory: () => 'ver_izh_m6_3s',
    },
  };
}

test('3S rebuilds full composite from component inputs and remains blocked by unrelated blockers', () => {
  const value = fixture();
  const result = preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(value));
  assert.equal(result.schema, 'izhgmu-medicine6-composite-rebuild-preflight/v1');
  assert.equal(result.status, 'qa_passed_blocked_by_remaining_blockers');
  assert.equal(result.rebuildMode, 'full_from_component_inputs_not_patch_in_place');
  assert.equal(result.baselineBlockerCount, 5);
  assert.equal(result.remainingBlockerCount, 4);
  assert.deepEqual(result.blockerDelta, { removed: [value.acceptance.blockerFingerprint], added: [] });
  assert.deepEqual(result.eventDelta, value.acceptance.eventDelta);
  assert.equal(result.baselineEventCount + 1, result.rebuiltEventCount);
  assert.equal(result.sharedQa.inputPublishable, true);
  assert.equal(result.sharedQa.outputPublishable, true);
  assert.ok(result.sharedQa.icsBytes > 0);
  assert.match(result.candidateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.candidateCanEnterPublicationAuthorization, false);
  assert.equal(result.patchInPlaceAllowed, false);
  assert.equal(result.persistentWriteAllowed, false);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.productionApplied, false);
  assert.equal(result.publishable, false);
  assert.equal(result.universityActivationAllowed, false);
  assert.equal(result.nextRequiredBoundary, 'resolve_remaining_blockers_and_repeat_full_composite_rebuild');
});

test('3S rejects a resolution whose target blocker is not in the fresh baseline composite', () => {
  const value = fixture();
  value.acceptance.blockerFingerprint = 'c'.repeat(64);
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(value)),
    /IZH_M6_COMPOSITE_REBUILD_TARGET_BLOCKER_NOT_IN_BASELINE/,
  );
});

test('3S rejects silent removal of an unrelated blocker during rebuild', () => {
  const value = fixture({ removeElectiveBlocker: true });
  value.acceptance.eventDelta = eventDelta(value.baseline.batch.events, value.rebuilt.batch.events);
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(value)),
    (error) => error?.code === 'IZH_M6_COMPOSITE_REBUILD_BLOCKER_DELTA_MISMATCH',
  );
});

test('3S rejects hidden event changes not covered by accepted 3R delta', () => {
  const value = fixture();
  const hidden = fixture({ hiddenEndTime: '12:00' });
  hidden.acceptance = structuredClone(value.acceptance);
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(hidden)),
    (error) => error?.code === 'IZH_M6_COMPOSITE_REBUILD_EVENT_DELTA_MISMATCH',
  );
});

test('3S rejects unsafe or publication-like 3R acceptance flags', () => {
  const value = fixture();
  value.acceptance.publishable = true;
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(value)),
    /IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_NOT_SAFE/,
  );
});

test('3S rejects duplicate resolution identity and duplicate target blocker', () => {
  const value = fixture();
  const args = preflightArgs(value);
  args.acceptances = [value.acceptance, structuredClone(value.acceptance)];
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(args),
    /IZH_M6_COMPOSITE_REBUILD_DUPLICATE_RESOLUTION|IZH_M6_COMPOSITE_REBUILD_DUPLICATE_TARGET_BLOCKER/,
  );
});

test('3S requires at least one QA-accepted 3R resolution', () => {
  const value = fixture();
  const args = preflightArgs(value);
  args.acceptances = [];
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(args),
    /IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_REQUIRED/,
  );
});

test('3S shared canonical QA remains authoritative for the freshly rebuilt composite', () => {
  const value = fixture({ invalidResolvedTime: true });
  assert.throws(
    () => preflightIzhgmuMedicine6FullCompositeRebuild(preflightArgs(value)),
    /Schedule input validation failed|SCHEDULE_NOT_PUBLISHABLE/,
  );
});

test('3S does not mutate baseline inputs, rebuilt inputs, or acceptances', () => {
  const value = fixture();
  const args = preflightArgs(value);
  const beforeBaseline = structuredClone(args.baselineInput);
  const beforeRebuilt = structuredClone(args.rebuiltInput);
  const beforeAcceptances = structuredClone(args.acceptances);
  preflightIzhgmuMedicine6FullCompositeRebuild(args);
  assert.deepEqual(args.baselineInput, beforeBaseline);
  assert.deepEqual(args.rebuiltInput, beforeRebuilt);
  assert.deepEqual(args.acceptances, beforeAcceptances);
});
