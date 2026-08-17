import {
  fingerprintIzhgmuMedicine6ResolutionBlocker,
  validateIzhgmuMedicine6ResolutionLedger,
} from './medicine6-resolution-ledger.mjs';

const ROUTES = new Map([
  ['cycle|elective_choice_required', 'cycle-medicine6'],
  ['lecture|elective_choice_required', 'lecture-medicine6'],
  ['lecture|stream_group_mapping_required', 'lecture-medicine6'],
  ['postsemester|end_time_missing_in_source', 'postsemester-medicine6'],
  ['postsemester|group_missing_from_reviewed_source', 'postsemester-medicine6'],
]);

function normalized(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertGroup(value) {
  const group = normalized(value);
  if (!/^6(?:0[1-9]|[12]\d|30)$/.test(group)) throw new Error('IZH_M6_REMATERIALIZATION_GROUP_REQUIRED');
  return group;
}

function sourceKey(fileName, sha256) {
  return `${normalized(fileName)}|${normalized(sha256).toLowerCase()}`;
}

function normalizeAvailableSources(availableSources) {
  if (!Array.isArray(availableSources)) throw new TypeError('medicine-6 available sources must be an array');
  const map = new Map();
  for (const source of availableSources) {
    const fileName = normalized(source?.fileName);
    const sha256 = normalized(source?.sha256).toLowerCase();
    if (!fileName || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('IZH_M6_REMATERIALIZATION_SOURCE_SNAPSHOT_INVALID');
    const key = sourceKey(fileName, sha256);
    if (map.has(key)) throw new Error('IZH_M6_REMATERIALIZATION_SOURCE_SNAPSHOT_DUPLICATE');
    map.set(key, {
      fileName,
      sha256,
      url: normalized(source?.url) || null,
      role: normalized(source?.role) || null,
    });
  }
  return map;
}

function requiredCandidateSources(record) {
  const candidate = record?.candidate;
  if (candidate?.kind === 'official_source_evidence') {
    return [{
      fileName: normalized(candidate.source?.fileName),
      sha256: normalized(candidate.source?.sha256).toLowerCase(),
      sourceReference: Array.isArray(candidate.source?.references) ? candidate.source.references.map(normalized).filter(Boolean) : [],
    }];
  }
  if (candidate?.kind === 'student_choice') {
    return (candidate.choices || []).map((choice) => ({
      fileName: normalized(choice?.sourceFile),
      sha256: normalized(choice?.sourceHash).toLowerCase(),
      sourceReference: normalized(choice?.sourceReference) ? [normalized(choice.sourceReference)] : [],
    }));
  }
  throw new Error('IZH_M6_REMATERIALIZATION_CANDIDATE_KIND_UNSUPPORTED');
}

function validateCandidateSources(record, availableSourceMap) {
  const required = requiredCandidateSources(record);
  if (required.length === 0) throw new Error('IZH_M6_REMATERIALIZATION_CANDIDATE_SOURCE_REQUIRED');
  for (const source of required) {
    if (!source.fileName || !/^[a-f0-9]{64}$/.test(source.sha256) || source.sourceReference.length === 0) {
      throw new Error('IZH_M6_REMATERIALIZATION_CANDIDATE_SOURCE_INVALID');
    }
    if (!availableSourceMap.has(sourceKey(source.fileName, source.sha256))) {
      throw new Error('IZH_M6_REMATERIALIZATION_SOURCE_SNAPSHOT_MISSING');
    }
  }
  return required;
}

function assertRecord(record) {
  const validation = validateIzhgmuMedicine6ResolutionLedger([record]);
  if (validation.status !== 'ok') throw new Error('IZH_M6_REMATERIALIZATION_LEDGER_RECORD_INVALID');
  if (record.status !== 'authorized_not_materialized') throw new Error('IZH_M6_REMATERIALIZATION_RECORD_STATE_INVALID');
  if (record.nextRequiredBoundary !== 'component_specific_rematerialization_and_full_qa') {
    throw new Error('IZH_M6_REMATERIALIZATION_NEXT_BOUNDARY_MISMATCH');
  }
}

function assertCurrentBlocker(record, currentBlocker) {
  if (!currentBlocker || typeof currentBlocker !== 'object' || Array.isArray(currentBlocker)) {
    throw new TypeError('medicine-6 current blocker must be an object');
  }
  const currentFingerprint = fingerprintIzhgmuMedicine6ResolutionBlocker(currentBlocker);
  if (currentFingerprint !== record.blockerFingerprint) throw new Error('IZH_M6_REMATERIALIZATION_STALE_BLOCKER');
  return currentFingerprint;
}

function resolveGroup(record, currentGroup) {
  const requested = assertGroup(currentGroup);
  const blockerGroup = normalized(record.blocker?.group);
  const candidateGroup = normalized(record.candidate?.group);
  if (blockerGroup && blockerGroup !== requested) throw new Error('IZH_M6_REMATERIALIZATION_BLOCKER_GROUP_MISMATCH');
  if (candidateGroup && candidateGroup !== requested) throw new Error('IZH_M6_REMATERIALIZATION_CANDIDATE_GROUP_MISMATCH');
  return requested;
}

function routeFor(record) {
  const sourceComponent = normalized(record.sourceComponent);
  const warning = normalized(record.warning);
  const route = ROUTES.get(`${sourceComponent}|${warning}`);
  if (!route) throw new Error('IZH_M6_REMATERIALIZATION_ROUTE_UNKNOWN');
  return { sourceComponent, warning, route };
}

export function prepareIzhgmuMedicine6RematerializationPlan({
  record,
  currentBlocker,
  currentGroup,
  availableSources = [],
} = {}) {
  assertRecord(record);
  const blockerFingerprint = assertCurrentBlocker(record, currentBlocker);
  const group = resolveGroup(record, currentGroup);
  const routing = routeFor(record);
  const sourceMap = normalizeAvailableSources(availableSources);
  const candidateSources = validateCandidateSources(record, sourceMap);

  return {
    schema: 'izhgmu-medicine6-rematerialization-plan/v1',
    status: 'preflight_ready',
    resolutionId: record.resolutionId,
    resolutionFingerprint: record.resolutionFingerprint,
    blockerFingerprint,
    candidateFingerprint: record.candidateFingerprint,
    group,
    resolutionClass: record.resolutionClass,
    sourceComponent: routing.sourceComponent,
    warning: routing.warning,
    targetAdapter: routing.route,
    candidateKind: record.candidate.kind,
    candidate: clone(record.candidate),
    candidateSources: clone(candidateSources),
    availableSources: [...sourceMap.values()].map(clone),
    clearsBlocker: false,
    mutatesSchedule: false,
    publishable: false,
    requiresComponentRematerialization: true,
    requiresCanonicalQa: true,
    requiresOutputQa: true,
    nextRequiredBoundary: `rematerialize:${routing.route}:then-full-qa`,
    productionSemantics: 'preflight_only_no_event_mutation',
  };
}

export function validateIzhgmuMedicine6RematerializationPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { status: 'error', errors: [{ code: 'plan_invalid' }] };
  }
  if (plan.schema !== 'izhgmu-medicine6-rematerialization-plan/v1') errors.push({ code: 'schema_invalid' });
  if (plan.status !== 'preflight_ready') errors.push({ code: 'status_invalid' });
  if (!/^izhgmu-m6:[a-f0-9]{64}$/.test(normalized(plan.resolutionId))) errors.push({ code: 'resolution_id_invalid' });
  if (!/^6(?:0[1-9]|[12]\d|30)$/.test(normalized(plan.group))) errors.push({ code: 'group_invalid' });
  if (![...ROUTES.values()].includes(plan.targetAdapter)) errors.push({ code: 'target_adapter_invalid' });
  if (plan.clearsBlocker !== false || plan.mutatesSchedule !== false || plan.publishable !== false) {
    errors.push({ code: 'preflight_must_not_materialize_or_publish' });
  }
  if (plan.requiresComponentRematerialization !== true || plan.requiresCanonicalQa !== true || plan.requiresOutputQa !== true) {
    errors.push({ code: 'required_followup_gate_missing' });
  }
  return {
    status: errors.length ? 'error' : 'ok',
    errors,
    productionSemantics: 'validated_preflight_no_event_mutation',
  };
}
