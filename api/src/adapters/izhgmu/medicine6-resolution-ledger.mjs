import { createHash } from 'node:crypto';

function normalized(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(normalized(value));
}

function validIsoInstant(value) {
  const text = normalized(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

function assertReadyCandidate(evaluatedProposal) {
  if (!evaluatedProposal || typeof evaluatedProposal !== 'object' || Array.isArray(evaluatedProposal)) {
    throw new TypeError('medicine-6 evaluated resolution proposal must be an object');
  }
  if (
    evaluatedProposal.status !== 'ready_for_explicit_apply'
    || evaluatedProposal.proposalAccepted !== true
    || evaluatedProposal.requiresExplicitApply !== true
    || evaluatedProposal.clearsBlocker !== false
    || evaluatedProposal.automaticApplyAllowed !== false
    || !evaluatedProposal.blocker
    || !evaluatedProposal.candidate
  ) {
    throw new Error('IZH_M6_RESOLUTION_CANDIDATE_NOT_READY');
  }
}

function assertAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new TypeError('medicine-6 resolution authorization must be an object');
  }
  if (authorization.explicit !== true) throw new Error('IZH_M6_RESOLUTION_EXPLICIT_AUTHORIZATION_REQUIRED');
  if (!normalized(authorization.authorizedBy)) throw new Error('IZH_M6_RESOLUTION_AUTHORIZED_BY_REQUIRED');
  if (!normalized(authorization.authorizationReference)) throw new Error('IZH_M6_RESOLUTION_AUTHORIZATION_REFERENCE_REQUIRED');
  if (!validIsoInstant(authorization.authorizedAt)) throw new Error('IZH_M6_RESOLUTION_AUTHORIZED_AT_INVALID');
  if (!isSha256(authorization.expectedBlockerFingerprint)) {
    throw new Error('IZH_M6_RESOLUTION_EXPECTED_BLOCKER_FINGERPRINT_REQUIRED');
  }
  if (!isSha256(authorization.expectedCandidateFingerprint)) {
    throw new Error('IZH_M6_RESOLUTION_EXPECTED_CANDIDATE_FINGERPRINT_REQUIRED');
  }
}

export function fingerprintIzhgmuMedicine6ResolutionBlocker(blocker) {
  return fingerprint(blocker);
}

export function fingerprintIzhgmuMedicine6ResolutionCandidate(candidate) {
  return fingerprint(candidate);
}

export function prepareIzhgmuMedicine6ResolutionAuthorizationTarget(evaluatedProposal) {
  assertReadyCandidate(evaluatedProposal);
  return {
    blockerFingerprint: fingerprintIzhgmuMedicine6ResolutionBlocker(evaluatedProposal.blocker),
    candidateFingerprint: fingerprintIzhgmuMedicine6ResolutionCandidate(evaluatedProposal.candidate),
    resolutionClass: normalized(evaluatedProposal.resolutionClass) || null,
    sourceComponent: normalized(evaluatedProposal.blocker?.source_component) || null,
    warning: normalized(evaluatedProposal.blocker?.warning) || null,
    productionSemantics: 'authorization_target_only_no_schedule_mutation',
  };
}

function buildRecord(evaluatedProposal, authorization) {
  const blockerFingerprint = fingerprintIzhgmuMedicine6ResolutionBlocker(evaluatedProposal.blocker);
  const candidateFingerprint = fingerprintIzhgmuMedicine6ResolutionCandidate(evaluatedProposal.candidate);
  if (authorization.expectedBlockerFingerprint.toLowerCase() !== blockerFingerprint) {
    throw new Error('IZH_M6_RESOLUTION_STALE_BLOCKER');
  }
  if (authorization.expectedCandidateFingerprint.toLowerCase() !== candidateFingerprint) {
    throw new Error('IZH_M6_RESOLUTION_CANDIDATE_MISMATCH');
  }

  const authorizationSnapshot = {
    explicit: true,
    authorizedBy: normalized(authorization.authorizedBy),
    authorizationReference: normalized(authorization.authorizationReference),
    authorizedAt: normalized(authorization.authorizedAt),
  };
  const recordIdentity = {
    schema: 'izhgmu-medicine6-resolution-record/v1',
    blockerFingerprint,
    candidateFingerprint,
    authorizationReference: authorizationSnapshot.authorizationReference,
  };
  const recordFingerprint = fingerprint(recordIdentity);

  return {
    schema: 'izhgmu-medicine6-resolution-record/v1',
    resolutionId: `izhgmu-m6:${recordFingerprint}`,
    recordFingerprint,
    status: 'authorized_not_materialized',
    resolutionClass: normalized(evaluatedProposal.resolutionClass) || null,
    sourceComponent: normalized(evaluatedProposal.blocker?.source_component) || null,
    warning: normalized(evaluatedProposal.blocker?.warning) || null,
    blockerFingerprint,
    candidateFingerprint,
    blocker: clone(evaluatedProposal.blocker),
    candidate: clone(evaluatedProposal.candidate),
    authorization: authorizationSnapshot,
    clearsBlocker: false,
    mutatesSchedule: false,
    publishable: false,
    nextRequiredBoundary: 'component_specific_rematerialization_and_full_qa',
  };
}

function validateExistingRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.schema !== 'izhgmu-medicine6-resolution-record/v1') return false;
  if (!normalized(record.resolutionId) || !isSha256(record.recordFingerprint)) return false;
  return true;
}

export function authorizeIzhgmuMedicine6ResolutionCandidate({
  evaluatedProposal,
  authorization,
  existingRecords = [],
} = {}) {
  assertReadyCandidate(evaluatedProposal);
  assertAuthorization(authorization);
  if (!Array.isArray(existingRecords)) throw new TypeError('medicine-6 existing resolution records must be an array');

  const record = buildRecord(evaluatedProposal, authorization);
  const sameId = existingRecords.filter((item) => item?.resolutionId === record.resolutionId);
  if (sameId.length > 1) throw new Error('IZH_M6_RESOLUTION_LEDGER_DUPLICATE_ID');
  if (sameId.length === 1) {
    const existing = sameId[0];
    if (!validateExistingRecord(existing)) throw new Error('IZH_M6_RESOLUTION_LEDGER_RECORD_INVALID');
    if (canonicalJson(existing) !== canonicalJson(record)) {
      throw new Error('IZH_M6_RESOLUTION_LEDGER_IMMUTABILITY_VIOLATION');
    }
    return {
      status: 'already_authorized',
      idempotent: true,
      record: clone(existing),
      clearsBlocker: false,
      mutatesSchedule: false,
      publishable: false,
    };
  }

  return {
    status: 'authorized',
    idempotent: false,
    record,
    clearsBlocker: false,
    mutatesSchedule: false,
    publishable: false,
  };
}

export function validateIzhgmuMedicine6ResolutionLedger(records = []) {
  if (!Array.isArray(records)) throw new TypeError('medicine-6 resolution ledger must be an array');
  const ids = new Set();
  const fingerprints = new Set();
  const errors = [];
  records.forEach((record, index) => {
    if (!validateExistingRecord(record)) {
      errors.push({ index, code: 'record_invalid' });
      return;
    }
    if (ids.has(record.resolutionId)) errors.push({ index, code: 'duplicate_resolution_id' });
    if (fingerprints.has(record.recordFingerprint)) errors.push({ index, code: 'duplicate_record_fingerprint' });
    ids.add(record.resolutionId);
    fingerprints.add(record.recordFingerprint);
    if (record.clearsBlocker !== false || record.mutatesSchedule !== false || record.publishable !== false) {
      errors.push({ index, code: 'ledger_record_must_not_materialize_or_publish' });
    }
  });
  return {
    status: errors.length ? 'error' : 'ok',
    recordCount: records.length,
    errors,
    productionSemantics: 'immutable_authorization_ledger_no_schedule_mutation',
  };
}
