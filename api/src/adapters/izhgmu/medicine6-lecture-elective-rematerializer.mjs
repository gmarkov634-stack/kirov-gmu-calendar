import {
  buildIzhgmuMedicine6LectureQaCandidate,
} from './lecture-medicine6-canonical.mjs';
import {
  fingerprintIzhgmuMedicine6RematerializationEvent,
} from './medicine6-resolution-acceptance.mjs';
import {
  fingerprintIzhgmuMedicine6ResolutionBlocker,
} from './medicine6-resolution-ledger.mjs';
import {
  validateIzhgmuMedicine6RematerializationPlan,
} from './medicine6-resolution-rematerialization.mjs';

function normalized(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizedHash(value) {
  const hash = normalized(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function eventDelta(beforeEvents, afterEvents) {
  const before = new Map();
  const after = new Map();
  for (const event of beforeEvents || []) {
    const key = fingerprintIzhgmuMedicine6RematerializationEvent(event);
    before.set(key, (before.get(key) || 0) + 1);
  }
  for (const event of afterEvents || []) {
    const key = fingerprintIzhgmuMedicine6RematerializationEvent(event);
    after.set(key, (after.get(key) || 0) + 1);
  }
  const added = [];
  const removed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const beforeCount = before.get(key) || 0;
    const afterCount = after.get(key) || 0;
    for (let index = 0; index < Math.max(0, afterCount - beforeCount); index += 1) added.push(key);
    for (let index = 0; index < Math.max(0, beforeCount - afterCount); index += 1) removed.push(key);
  }
  return { added: added.sort(), removed: removed.sort() };
}

function assertPlan(plan) {
  const validation = validateIzhgmuMedicine6RematerializationPlan(plan);
  if (validation.status !== 'ok') {
    const error = new Error('IzhGMU medicine-6 rematerialization plan is invalid');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_PLAN_INVALID';
    error.validation = validation;
    throw error;
  }
  if (
    plan.targetAdapter !== 'lecture-medicine6'
    || plan.sourceComponent !== 'lecture'
    || plan.warning !== 'elective_choice_required'
    || plan.candidateKind !== 'student_choice'
    || plan.candidate?.kind !== 'student_choice'
    || plan.candidate?.explicit !== true
  ) {
    const error = new Error('IzhGMU medicine-6 lecture elective rematerializer received the wrong plan route');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_ROUTE_MISMATCH';
    throw error;
  }
}

function assertComponent(component, plan) {
  const parsed = component?.parsed;
  if (parsed?.profile !== 'IZH-LECTURE-MEDICINE6') {
    const error = new Error('IzhGMU medicine-6 lecture component is required');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_COMPONENT_INVALID';
    throw error;
  }
  const group = normalized(component?.metadata?.groupCode);
  if (group !== normalized(plan.group) || !parsed.courseGroups?.includes(group)) {
    const error = new Error('IzhGMU medicine-6 lecture component group does not match plan');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_GROUP_MISMATCH';
    throw error;
  }
  const fileName = normalized(component?.source?.fileName);
  const fileHash = normalizedHash(component?.source?.fileHash);
  if (!fileName || !fileHash) {
    const error = new Error('IzhGMU medicine-6 lecture component source identity is incomplete');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_SOURCE_INVALID';
    throw error;
  }
  return { parsed, group, fileName, fileHash };
}

function assertTargetBlocker(beforeBlockers, plan) {
  if (!Array.isArray(beforeBlockers)) throw new TypeError('medicine-6 beforeBlockers must be an array');
  const matches = beforeBlockers.filter((blocker) => (
    fingerprintIzhgmuMedicine6ResolutionBlocker(blocker) === plan.blockerFingerprint
  ));
  if (matches.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 target blocker must exist exactly once before rematerialization: ${matches.length}`);
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_TARGET_BLOCKER_STALE';
    throw error;
  }
  const blocker = matches[0];
  if (blocker.source_component !== 'lecture' || blocker.warning !== 'elective_choice_required') {
    const error = new Error('IzhGMU medicine-6 target blocker is not a lecture elective blocker');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_TARGET_BLOCKER_INVALID';
    throw error;
  }
  return blocker;
}

function sourceReferenceSet(series) {
  return new Set((series?.references || []).map((item) => normalized(item?.range)).filter(Boolean));
}

function assertChoiceSourceBinding(plan, source, targetBlocker) {
  const choices = Array.isArray(plan.candidate?.choices) ? plan.candidate.choices : [];
  const targetSlots = [...new Set((targetBlocker.slots || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const choiceSlots = [...new Set(choices.map((item) => Number(item?.slot)).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!targetSlots.length || targetSlots.join('|') !== choiceSlots.join('|') || choices.length !== choiceSlots.length) {
    const error = new Error('IzhGMU medicine-6 lecture elective choices must cover the blocker slots exactly once');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_SLOT_COVERAGE_MISMATCH';
    throw error;
  }
  const planSources = Array.isArray(plan.candidateSources) ? plan.candidateSources : [];
  return choices.map((choice) => {
    const sourceReference = normalized(choice?.sourceReference);
    const alternative = normalized(choice?.alternative);
    const slot = Number(choice?.slot);
    if (
      normalized(choice?.sourceFile) !== source.fileName
      || normalizedHash(choice?.sourceHash) !== source.fileHash
      || !sourceReference
      || !alternative
    ) {
      const error = new Error('IzhGMU medicine-6 lecture elective choice is not bound to the exact component source');
      error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_SOURCE_BINDING_MISMATCH';
      throw error;
    }
    const sourceEntry = planSources.find((item) => (
      normalized(item.fileName) === source.fileName
      && normalizedHash(item.sha256) === source.fileHash
      && Array.isArray(item.sourceReference)
      && item.sourceReference.map(normalized).includes(sourceReference)
    ));
    if (!sourceEntry) {
      const error = new Error('IzhGMU medicine-6 lecture elective source reference is not present in the approved plan');
      error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_PLAN_SOURCE_REFERENCE_MISMATCH';
      throw error;
    }
    return { slot, alternative, sourceReference };
  });
}

function selectedSourceSeries(parsed, choice) {
  const matches = (parsed.electiveSeries || []).filter((item) => (
    Number(item?.electiveSlot) === choice.slot
    && normalized(item?.discipline) === choice.alternative
    && sourceReferenceSet(item).has(choice.sourceReference)
  ));
  if (matches.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 lecture elective alternative is not uniquely source-bound for slot ${choice.slot}`);
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_ALTERNATIVE_NOT_SOURCE_BOUND';
    error.slot = choice.slot;
    error.alternative = choice.alternative;
    throw error;
  }
  const sourceSeries = matches[0];
  if (!Array.isArray(sourceSeries.dates) || sourceSeries.dates.length === 0 || !normalized(sourceSeries.startTime) || !normalized(sourceSeries.endTime)) {
    const error = new Error(`IzhGMU medicine-6 lecture elective source series is missing dates or time for slot ${choice.slot}`);
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_SOURCE_TIMING_INCOMPLETE';
    throw error;
  }
  return sourceSeries;
}

function materializedSeries(sourceSeries, group, choice) {
  const next = clone(sourceSeries);
  next.groups = [group];
  next.audienceScope = 'student_choice';
  next.choiceRequired = false;
  next.status = 'ok';
  next.warning = null;
  next.warnings = [];
  next.selectedByExplicitStudentChoice = true;
  next.selectionReference = choice.sourceReference;
  next.ruleIds = [...new Set([...(next.ruleIds || []), 'IZH-R61', 'IZH-R62', 'IZH-R63'])];
  return next;
}

function rematerializedParsed(parsed, resolvedSeries) {
  const next = clone(parsed);
  const before = Array.isArray(next.blockers) ? next.blockers : [];
  const targetCount = before.filter((item) => item?.warning === 'elective_choice_required').length;
  if (targetCount !== 1) {
    const error = new Error(`IzhGMU medicine-6 lecture elective blocker must exist exactly once in parsed source: ${targetCount}`);
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_SOURCE_BLOCKER_NOT_UNIQUE';
    throw error;
  }
  next.blockers = before.filter((item) => item?.warning !== 'elective_choice_required');
  next.resolvedStudentSeries = [...(next.resolvedStudentSeries || []), ...resolvedSeries.map(clone)];
  next.publishable = (next.reviewRequired || []).length === 0 && next.blockers.length === 0;
  next.rematerialization = {
    mode: 'explicit_student_choice',
    slots: resolvedSeries.map((item) => item.electiveSlot).sort((a, b) => a - b),
    disciplines: resolvedSeries.map((item) => item.discipline),
    persistentWrite: false,
  };
  return next;
}

function afterBlockers(beforeBlockers, plan) {
  let removed = 0;
  const next = [];
  for (const blocker of beforeBlockers) {
    if (fingerprintIzhgmuMedicine6ResolutionBlocker(blocker) === plan.blockerFingerprint) {
      removed += 1;
      continue;
    }
    next.push(clone(blocker));
  }
  if (removed !== 1) {
    const error = new Error('IzhGMU medicine-6 lecture elective blocker transition is not exactly one');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_BLOCKER_TRANSITION_INVALID';
    throw error;
  }
  return next;
}

export function executeIzhgmuMedicine6LectureElectiveRematerialization({
  plan,
  component,
  beforeBlockers,
} = {}) {
  assertPlan(plan);
  const source = assertComponent(component, plan);
  const targetBlocker = assertTargetBlocker(beforeBlockers, plan);
  const choices = assertChoiceSourceBinding(plan, source, targetBlocker);
  const selected = choices.map((choice) => ({ choice, sourceSeries: selectedSourceSeries(source.parsed, choice) }));

  const beforeBatch = buildIzhgmuMedicine6LectureQaCandidate({
    parsed: clone(source.parsed),
    metadata: clone(component.metadata),
    source: clone(component.source),
  });
  const resolvedSeries = selected.map(({ choice, sourceSeries }) => materializedSeries(sourceSeries, source.group, choice));
  const afterParsed = rematerializedParsed(source.parsed, resolvedSeries);
  const afterBatch = buildIzhgmuMedicine6LectureQaCandidate({
    parsed: afterParsed,
    metadata: clone(component.metadata),
    source: clone(component.source),
  });
  const nextBlockers = afterBlockers(beforeBlockers, plan);
  const delta = eventDelta(beforeBatch.events, afterBatch.events);
  const expectedAdded = resolvedSeries.reduce((sum, item) => sum + new Set(item.dates || []).size, 0);
  if (delta.removed.length !== 0 || delta.added.length !== expectedAdded) {
    const error = new Error('IzhGMU medicine-6 lecture elective rematerialization produced an unexpected event delta');
    error.code = 'IZH_M6_LECTURE_ELECTIVE_REMATERIALIZER_EVENT_DELTA_INVALID';
    error.expectedAdded = expectedAdded;
    error.observed = delta;
    throw error;
  }

  return {
    schema: 'izhgmu-medicine6-rematerialization-result/v1',
    resolutionId: plan.resolutionId,
    resolutionFingerprint: plan.resolutionFingerprint,
    blockerFingerprint: plan.blockerFingerprint,
    candidateFingerprint: plan.candidateFingerprint,
    group: plan.group,
    targetAdapter: plan.targetAdapter,
    afterBatch,
    afterBlockers: nextBlockers,
    eventDelta: delta,
    rematerializedComponent: {
      sourceComponent: 'lecture',
      parsed: afterParsed,
      metadata: clone(component.metadata),
      source: clone(component.source),
    },
    resolvedSeries,
    clearsPersistentBlocker: false,
    mutatesPersistentSchedule: false,
    persistentWriteAllowed: false,
    publicationAllowed: false,
    productionApplied: false,
    nextRequiredBoundary: 'rematerialization_result_acceptance_and_full_qa',
    productionSemantics: 'pure_lecture_elective_candidate_only_no_persistent_write',
  };
}
