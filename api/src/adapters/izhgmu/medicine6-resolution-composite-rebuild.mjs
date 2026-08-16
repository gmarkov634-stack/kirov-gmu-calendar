import { createHash } from 'node:crypto';

import { prepareSchedulePublication } from '../../schedule/pipeline.js';
import { buildIzhgmuMedicine6CompositeCandidate } from './medicine6-composite.mjs';
import {
  fingerprintIzhgmuMedicine6RematerializationEvent,
} from './medicine6-resolution-acceptance.mjs';
import {
  fingerprintIzhgmuMedicine6ResolutionBlocker,
} from './medicine6-resolution-ledger.mjs';

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
  return /^[a-f0-9]{64}$/.test(normalized(value).toLowerCase());
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

function blockerDelta(beforeBlockers, afterBlockers) {
  const before = fingerprintMultiset(beforeBlockers, fingerprintIzhgmuMedicine6ResolutionBlocker);
  const after = fingerprintMultiset(afterBlockers, fingerprintIzhgmuMedicine6ResolutionBlocker);
  return {
    removed: multisetDifference(before, after),
    added: multisetDifference(after, before),
  };
}

function eventDelta(beforeEvents, afterEvents) {
  const before = fingerprintMultiset(beforeEvents, fingerprintIzhgmuMedicine6RematerializationEvent);
  const after = fingerprintMultiset(afterEvents, fingerprintIzhgmuMedicine6RematerializationEvent);
  return {
    removed: multisetDifference(before, after),
    added: multisetDifference(after, before),
  };
}

function assertAcceptance(acceptance) {
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) {
    throw new TypeError('medicine-6 3R acceptance must be an object');
  }
  if (acceptance.schema !== 'izhgmu-medicine6-rematerialization-acceptance/v1') {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_SCHEMA_INVALID');
  }
  if (
    acceptance.status !== 'qa_accepted_not_published'
    || acceptance.targetBlockerRemovedInCandidateState !== true
    || acceptance.sharedQa?.inputPublishable !== true
    || acceptance.sharedQa?.outputPublishable !== true
    || !(Number(acceptance.sharedQa?.icsBytes) > 0)
    || acceptance.clearsBlocker !== false
    || acceptance.mutatesSchedule !== false
    || acceptance.productionApplied !== false
    || acceptance.publishable !== false
    || acceptance.requiresFullCompositeRebuild !== true
    || acceptance.requiresPublicationQa !== true
    || acceptance.nextRequiredBoundary !== 'full_composite_rebuild_and_publication_qa'
  ) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_NOT_SAFE');
  }
  for (const field of ['resolutionFingerprint', 'blockerFingerprint', 'candidateFingerprint']) {
    if (!isFingerprint(acceptance[field])) {
      const error = new Error(`IzhGMU medicine-6 3R acceptance ${field} is invalid`);
      error.code = 'IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_FINGERPRINT_INVALID';
      error.field = field;
      throw error;
    }
  }
  if (!normalized(acceptance.resolutionId) || !normalized(acceptance.group) || !normalized(acceptance.targetAdapter)) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_BINDING_REQUIRED');
  }
  if (!acceptance.eventDelta || !Array.isArray(acceptance.eventDelta.added) || !Array.isArray(acceptance.eventDelta.removed)) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_DELTA_REQUIRED');
  }
  for (const value of [...acceptance.eventDelta.added, ...acceptance.eventDelta.removed]) {
    if (!isFingerprint(value)) throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_DELTA_INVALID');
  }
}

function assertSameCompositeContext(before, after) {
  if (before.group !== after.group) throw new Error('IZH_M6_COMPOSITE_REBUILD_GROUP_CHANGED');
  const left = before.batch?.schedule;
  const right = after.batch?.schedule;
  if (!left || !right) throw new Error('IZH_M6_COMPOSITE_REBUILD_SCHEDULE_REQUIRED');
  for (const field of ['university_code', 'academic_year', 'semester', 'faculty_code', 'course', 'group']) {
    if (canonicalJson(left[field]) !== canonicalJson(right[field])) {
      const error = new Error(`IzhGMU medicine-6 full rebuild changed schedule context ${field}`);
      error.code = 'IZH_M6_COMPOSITE_REBUILD_CONTEXT_CHANGED';
      error.field = field;
      throw error;
    }
  }
  if (canonicalJson(left.period) !== canonicalJson(right.period)) {
    const error = new Error('IzhGMU medicine-6 full rebuild changed schedule period');
    error.code = 'IZH_M6_COMPOSITE_REBUILD_CONTEXT_CHANGED';
    error.field = 'period';
    throw error;
  }
}

function validateAcceptanceSet(acceptances, baseline) {
  if (!Array.isArray(acceptances) || acceptances.length === 0) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_REQUIRED');
  }
  const baselineBlockers = fingerprintMultiset(baseline.blockers, fingerprintIzhgmuMedicine6ResolutionBlocker);
  const resolutionIds = new Set();
  const resolutionFingerprints = new Set();
  const targetBlockers = new Set();
  const deltaFingerprints = new Set();

  for (const acceptance of acceptances) {
    assertAcceptance(acceptance);
    if (normalized(acceptance.group) !== baseline.group) {
      throw new Error('IZH_M6_COMPOSITE_REBUILD_ACCEPTANCE_GROUP_MISMATCH');
    }
    if (resolutionIds.has(acceptance.resolutionId) || resolutionFingerprints.has(acceptance.resolutionFingerprint)) {
      throw new Error('IZH_M6_COMPOSITE_REBUILD_DUPLICATE_RESOLUTION');
    }
    if (targetBlockers.has(acceptance.blockerFingerprint)) {
      throw new Error('IZH_M6_COMPOSITE_REBUILD_DUPLICATE_TARGET_BLOCKER');
    }
    if ((baselineBlockers.get(acceptance.blockerFingerprint) || 0) !== 1) {
      throw new Error('IZH_M6_COMPOSITE_REBUILD_TARGET_BLOCKER_NOT_IN_BASELINE');
    }
    resolutionIds.add(acceptance.resolutionId);
    resolutionFingerprints.add(acceptance.resolutionFingerprint);
    targetBlockers.add(acceptance.blockerFingerprint);

    for (const [side, values] of Object.entries(acceptance.eventDelta)) {
      for (const value of values) {
        const key = `${side}:${value}`;
        if (deltaFingerprints.has(key)) {
          throw new Error('IZH_M6_COMPOSITE_REBUILD_OVERLAPPING_ACCEPTANCE_DELTA');
        }
        deltaFingerprints.add(key);
      }
    }
  }

  return {
    resolutionIds: [...resolutionIds].sort(),
    resolutionFingerprints: [...resolutionFingerprints].sort(),
    targetBlockerFingerprints: [...targetBlockers].sort(),
  };
}

function expectedEventDelta(acceptances) {
  return {
    added: acceptances.flatMap((item) => item.eventDelta.added).map((value) => value.toLowerCase()).sort(),
    removed: acceptances.flatMap((item) => item.eventDelta.removed).map((value) => value.toLowerCase()).sort(),
  };
}

function assertExactBlockerTransition(baseline, rebuilt, acceptedTargetBlockers) {
  const actual = blockerDelta(baseline.blockers, rebuilt.blockers);
  const expected = { removed: [...acceptedTargetBlockers].sort(), added: [] };
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    const error = new Error('IzhGMU medicine-6 full rebuild blocker delta differs from accepted resolutions');
    error.code = 'IZH_M6_COMPOSITE_REBUILD_BLOCKER_DELTA_MISMATCH';
    error.expected = expected;
    error.observed = actual;
    throw error;
  }
  return actual;
}

function assertExactEventTransition(baseline, rebuilt, acceptances) {
  const actual = eventDelta(baseline.batch.events, rebuilt.batch.events);
  const expected = expectedEventDelta(acceptances);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    const error = new Error('IzhGMU medicine-6 full rebuild event delta differs from accepted rematerializations');
    error.code = 'IZH_M6_COMPOSITE_REBUILD_EVENT_DELTA_MISMATCH';
    error.expected = expected;
    error.observed = actual;
    throw error;
  }
  return actual;
}

function candidateFingerprint(rebuilt, acceptanceSet) {
  return fingerprint({
    schema: 'izhgmu-medicine6-composite-rebuild-candidate/v1',
    group: rebuilt.group,
    batch: rebuilt.batch,
    blockers: rebuilt.blockers,
    acceptedResolutionFingerprints: acceptanceSet.resolutionFingerprints,
  });
}

export function preflightIzhgmuMedicine6FullCompositeRebuild({
  baselineInput,
  rebuiltInput,
  acceptances,
  publicationOptions = {},
} = {}) {
  if (!baselineInput || !rebuiltInput) throw new TypeError('medicine-6 baselineInput and rebuiltInput are required');

  const baselineInputSnapshot = clone(baselineInput);
  const rebuiltInputSnapshot = clone(rebuiltInput);
  const acceptancesSnapshot = clone(acceptances);

  // Both states are built from component inputs here. A caller cannot provide a patched composite batch.
  const baseline = buildIzhgmuMedicine6CompositeCandidate(clone(baselineInput));
  const rebuilt = buildIzhgmuMedicine6CompositeCandidate(clone(rebuiltInput));
  assertSameCompositeContext(baseline, rebuilt);

  const acceptanceSet = validateAcceptanceSet(acceptances, baseline);
  const blockers = assertExactBlockerTransition(baseline, rebuilt, acceptanceSet.targetBlockerFingerprints);
  const events = assertExactEventTransition(baseline, rebuilt, acceptances);

  const prepared = prepareSchedulePublication(clone(rebuilt.batch), publicationOptions);
  if (!prepared.inputQa?.publishable || !prepared.outputQa?.publishable || typeof prepared.ics !== 'string' || !prepared.ics.length) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_SHARED_QA_NOT_PUBLISHABLE');
  }

  if (
    canonicalJson(baselineInput) !== canonicalJson(baselineInputSnapshot)
    || canonicalJson(rebuiltInput) !== canonicalJson(rebuiltInputSnapshot)
    || canonicalJson(acceptances) !== canonicalJson(acceptancesSnapshot)
  ) {
    throw new Error('IZH_M6_COMPOSITE_REBUILD_MUTATED_INPUT');
  }

  const remainingBlockers = clone(rebuilt.blockers);
  const noRemainingBlockers = remainingBlockers.length === 0;
  const rebuildCandidateFingerprint = candidateFingerprint(rebuilt, acceptanceSet);

  return {
    schema: 'izhgmu-medicine6-composite-rebuild-preflight/v1',
    status: noRemainingBlockers
      ? 'qa_passed_ready_for_explicit_publication_authorization'
      : 'qa_passed_blocked_by_remaining_blockers',
    group: rebuilt.group,
    rebuildMode: 'full_from_component_inputs_not_patch_in_place',
    candidateFingerprint: rebuildCandidateFingerprint,
    acceptedResolutionIds: acceptanceSet.resolutionIds,
    acceptedResolutionFingerprints: acceptanceSet.resolutionFingerprints,
    acceptedBlockerFingerprints: acceptanceSet.targetBlockerFingerprints,
    blockerDelta: blockers,
    eventDelta: events,
    baselineEventCount: baseline.batch.events.length,
    rebuiltEventCount: rebuilt.batch.events.length,
    baselineBlockerCount: baseline.blockers.length,
    remainingBlockerCount: remainingBlockers.length,
    remainingBlockers,
    sharedQa: {
      inputPublishable: true,
      outputPublishable: true,
      icsBytes: Buffer.byteLength(prepared.ics, 'utf8'),
    },
    candidateCanEnterPublicationAuthorization: noRemainingBlockers,
    clearsPersistentBlocker: false,
    mutatesPersistentSchedule: false,
    patchInPlaceAllowed: false,
    persistentWriteAllowed: false,
    publicationAuthorized: false,
    productionApplied: false,
    publishable: false,
    universityActivationAllowed: false,
    nextRequiredBoundary: noRemainingBlockers
      ? 'explicit_publication_authorization'
      : 'resolve_remaining_blockers_and_repeat_full_composite_rebuild',
    productionSemantics: 'full_composite_rebuild_qa_only_no_persistent_write',
    candidateSnapshot: {
      profile: rebuilt.profile,
      batch: clone(rebuilt.batch),
      blockers: remainingBlockers,
    },
  };
}
