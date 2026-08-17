import { createHash } from 'node:crypto';

import { prepareSchedulePublication } from '../../schedule/pipeline.js';
import { fingerprintIzhgmuMedicine6ResolutionBlocker } from './medicine6-resolution-ledger.mjs';
import { validateIzhgmuMedicine6RematerializationPlan } from './medicine6-resolution-rematerialization.mjs';

function normalized(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isFingerprint(value) {
  return /^[a-f0-9]{64}$/.test(normalized(value));
}

function semanticEventKey(event) {
  return [
    event?.timing?.date || '',
    event?.timing?.start_time || '',
    event?.timing?.end_time || '',
    event?.timing?.all_day ? '1' : '0',
    event?.lesson?.discipline?.normalized || event?.lesson?.discipline?.raw || '',
    event?.lesson?.type?.code || '',
    event?.audience?.group || '',
  ].join('|');
}

export function fingerprintIzhgmuMedicine6RematerializationEvent(event) {
  return fingerprint(event);
}

function fingerprintMultiset(items, fingerprintFn) {
  const counts = new Map();
  for (const item of items || []) {
    const key = fingerprintFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function multisetDifference(left, right) {
  const result = [];
  for (const [key, count] of left.entries()) {
    const remaining = count - (right.get(key) || 0);
    for (let index = 0; index < Math.max(0, remaining); index += 1) result.push(key);
  }
  return result.sort();
}

function eventDelta(beforeEvents, afterEvents) {
  const before = fingerprintMultiset(beforeEvents, fingerprintIzhgmuMedicine6RematerializationEvent);
  const after = fingerprintMultiset(afterEvents, fingerprintIzhgmuMedicine6RematerializationEvent);
  return {
    removed: multisetDifference(before, after),
    added: multisetDifference(after, before),
  };
}

function assertNoSemanticDuplicates(events) {
  const seen = new Set();
  const duplicates = [];
  for (const event of events || []) {
    const key = semanticEventKey(event);
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (duplicates.length) {
    const error = new Error(`IzhGMU medicine-6 rematerialized candidate contains semantic duplicates: ${new Set(duplicates).size}`);
    error.code = 'IZH_M6_REMATERIALIZATION_SEMANTIC_DUPLICATE';
    error.duplicates = [...new Set(duplicates)];
    throw error;
  }
}

function assertPlan(plan) {
  const validation = validateIzhgmuMedicine6RematerializationPlan(plan);
  if (validation.status !== 'ok') {
    const error = new Error('IzhGMU medicine-6 rematerialization plan failed 3Q validation');
    error.code = 'IZH_M6_REMATERIALIZATION_PLAN_INVALID';
    error.validation = validation;
    throw error;
  }
}

function assertResultBinding(plan, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('medicine-6 rematerialization result must be an object');
  }
  if (result.schema !== 'izhgmu-medicine6-rematerialization-result/v1') {
    throw new Error('IZH_M6_REMATERIALIZATION_RESULT_SCHEMA_INVALID');
  }
  const pairs = [
    ['resolutionId', plan.resolutionId],
    ['resolutionFingerprint', plan.resolutionFingerprint],
    ['blockerFingerprint', plan.blockerFingerprint],
    ['candidateFingerprint', plan.candidateFingerprint],
    ['group', plan.group],
    ['targetAdapter', plan.targetAdapter],
  ];
  for (const [field, expected] of pairs) {
    if (normalized(result[field]) !== normalized(expected)) {
      const error = new Error(`IzhGMU medicine-6 rematerialization result ${field} mismatch`);
      error.code = 'IZH_M6_REMATERIALIZATION_RESULT_BINDING_MISMATCH';
      error.field = field;
      error.expected = expected;
      error.observed = result[field] ?? null;
      throw error;
    }
  }
  if (!result.afterBatch || !Array.isArray(result.afterBatch.events) || !Array.isArray(result.afterBlockers)) {
    throw new Error('IZH_M6_REMATERIALIZATION_RESULT_PAYLOAD_INVALID');
  }
  if (!result.eventDelta || !Array.isArray(result.eventDelta.added) || !Array.isArray(result.eventDelta.removed)) {
    throw new Error('IZH_M6_REMATERIALIZATION_RESULT_DELTA_REQUIRED');
  }
}

function assertScheduleContextPreserved(beforeBatch, afterBatch, group) {
  const before = beforeBatch?.schedule;
  const after = afterBatch?.schedule;
  if (!before || !after) throw new Error('IZH_M6_REMATERIALIZATION_BATCH_CONTEXT_REQUIRED');
  const fields = ['university_code', 'academic_year', 'semester', 'faculty_code', 'course', 'group'];
  for (const field of fields) {
    if (canonicalJson(before[field]) !== canonicalJson(after[field])) {
      const error = new Error(`IzhGMU medicine-6 rematerialization changed schedule context field ${field}`);
      error.code = 'IZH_M6_REMATERIALIZATION_CONTEXT_CHANGED';
      error.field = field;
      throw error;
    }
  }
  if (canonicalJson(before.period) !== canonicalJson(after.period)) {
    const error = new Error('IzhGMU medicine-6 rematerialization changed schedule period');
    error.code = 'IZH_M6_REMATERIALIZATION_CONTEXT_CHANGED';
    error.field = 'period';
    throw error;
  }
  if (normalized(after.group) !== normalized(group)) throw new Error('IZH_M6_REMATERIALIZATION_RESULT_GROUP_MISMATCH');
}

function blockerCounts(blockers) {
  return fingerprintMultiset(blockers, fingerprintIzhgmuMedicine6ResolutionBlocker);
}

function assertTargetBlockerTransition(plan, beforeBlockers, afterBlockers) {
  if (!Array.isArray(beforeBlockers) || !Array.isArray(afterBlockers)) {
    throw new TypeError('medicine-6 before/after blockers must be arrays');
  }
  const target = plan.blockerFingerprint;
  const before = blockerCounts(beforeBlockers);
  const after = blockerCounts(afterBlockers);
  if ((before.get(target) || 0) !== 1) throw new Error('IZH_M6_REMATERIALIZATION_TARGET_BLOCKER_BEFORE_NOT_EXACT');
  if ((after.get(target) || 0) !== 0) throw new Error('IZH_M6_REMATERIALIZATION_TARGET_BLOCKER_NOT_REMOVED_IN_CANDIDATE');

  before.delete(target);
  after.delete(target);
  if (canonicalJson([...before.entries()].sort()) !== canonicalJson([...after.entries()].sort())) {
    throw new Error('IZH_M6_REMATERIALIZATION_UNRELATED_BLOCKERS_CHANGED');
  }
}

function normalizeDeclaredDelta(delta) {
  const normalizeSide = (values, side) => values.map((value) => {
    const fp = normalized(value).toLowerCase();
    if (!isFingerprint(fp)) throw new Error(`IZH_M6_REMATERIALIZATION_${side}_DELTA_FINGERPRINT_INVALID`);
    return fp;
  }).sort();
  return {
    added: normalizeSide(delta.added, 'ADDED'),
    removed: normalizeSide(delta.removed, 'REMOVED'),
  };
}

function assertExactDelta(beforeBatch, afterBatch, declaredDelta) {
  const actual = eventDelta(beforeBatch.events, afterBatch.events);
  const declared = normalizeDeclaredDelta(declaredDelta);
  if (canonicalJson(actual) !== canonicalJson(declared)) {
    const error = new Error('IzhGMU medicine-6 rematerialization event delta mismatch');
    error.code = 'IZH_M6_REMATERIALIZATION_EVENT_DELTA_MISMATCH';
    error.expected = actual;
    error.observed = declared;
    throw error;
  }
  if (actual.added.length + actual.removed.length === 0) {
    throw new Error('IZH_M6_REMATERIALIZATION_EVENT_DELTA_EMPTY');
  }
  return actual;
}

export function acceptIzhgmuMedicine6RematerializationResult({
  plan,
  beforeBatch,
  beforeBlockers,
  result,
  publicationOptions = {},
} = {}) {
  assertPlan(plan);
  assertResultBinding(plan, result);
  if (!beforeBatch || !Array.isArray(beforeBatch.events)) throw new TypeError('medicine-6 beforeBatch is required');

  const beforeBatchSnapshot = clone(beforeBatch);
  const beforeBlockersSnapshot = clone(beforeBlockers);
  const resultSnapshot = clone(result);

  assertScheduleContextPreserved(beforeBatch, result.afterBatch, plan.group);
  assertTargetBlockerTransition(plan, beforeBlockers, result.afterBlockers);
  const delta = assertExactDelta(beforeBatch, result.afterBatch, result.eventDelta);
  assertNoSemanticDuplicates(result.afterBatch.events);

  const prepared = prepareSchedulePublication(clone(result.afterBatch), publicationOptions);
  if (!prepared.inputQa?.publishable || !prepared.outputQa?.publishable || typeof prepared.ics !== 'string' || !prepared.ics.length) {
    throw new Error('IZH_M6_REMATERIALIZATION_SHARED_QA_NOT_PUBLISHABLE');
  }

  if (
    canonicalJson(beforeBatch) !== canonicalJson(beforeBatchSnapshot)
    || canonicalJson(beforeBlockers) !== canonicalJson(beforeBlockersSnapshot)
    || canonicalJson(result) !== canonicalJson(resultSnapshot)
  ) {
    throw new Error('IZH_M6_REMATERIALIZATION_ACCEPTANCE_MUTATED_INPUT');
  }

  return {
    schema: 'izhgmu-medicine6-rematerialization-acceptance/v1',
    status: 'qa_accepted_not_published',
    resolutionId: plan.resolutionId,
    resolutionFingerprint: plan.resolutionFingerprint,
    blockerFingerprint: plan.blockerFingerprint,
    candidateFingerprint: plan.candidateFingerprint,
    group: plan.group,
    targetAdapter: plan.targetAdapter,
    eventDelta: delta,
    beforeEventCount: beforeBatch.events.length,
    afterEventCount: result.afterBatch.events.length,
    beforeBlockerCount: beforeBlockers.length,
    afterBlockerCount: result.afterBlockers.length,
    targetBlockerRemovedInCandidateState: true,
    sharedQa: {
      inputPublishable: true,
      outputPublishable: true,
      icsBytes: Buffer.byteLength(prepared.ics, 'utf8'),
    },
    clearsBlocker: false,
    mutatesSchedule: false,
    productionApplied: false,
    publishable: false,
    requiresFullCompositeRebuild: true,
    requiresPublicationQa: true,
    nextRequiredBoundary: 'full_composite_rebuild_and_publication_qa',
    productionSemantics: 'qa_accepted_candidate_only_no_persistent_mutation',
  };
}
