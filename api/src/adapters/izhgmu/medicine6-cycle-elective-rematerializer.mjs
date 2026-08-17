import {
  buildIzhgmuCycleQaCandidate,
} from './cycle-canonical.mjs';
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
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_PLAN_INVALID';
    error.validation = validation;
    throw error;
  }
  if (
    plan.targetAdapter !== 'cycle-medicine6'
    || plan.sourceComponent !== 'cycle'
    || plan.warning !== 'elective_choice_required'
    || plan.candidateKind !== 'student_choice'
    || plan.candidate?.kind !== 'student_choice'
    || plan.candidate?.explicit !== true
  ) {
    const error = new Error('IzhGMU medicine-6 cycle rematerializer received the wrong plan route');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_ROUTE_MISMATCH';
    throw error;
  }
}

function assertComponent(component, plan) {
  const parsed = component?.parsed;
  if (parsed?.profile !== 'IZH-CYCLE' || parsed?.sourceProfile !== 'IZH-CYCLE-MEDICINE6') {
    const error = new Error('IzhGMU medicine-6 cycle component is required');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_COMPONENT_INVALID';
    throw error;
  }
  const group = normalized(component?.metadata?.groupCode ?? parsed.group);
  if (group !== normalized(plan.group) || normalized(parsed.group) !== normalized(plan.group)) {
    const error = new Error('IzhGMU medicine-6 cycle component group does not match plan');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_GROUP_MISMATCH';
    throw error;
  }
  const fileName = normalized(component?.source?.fileName);
  const fileHash = normalizedHash(component?.source?.fileHash);
  if (!fileName || !fileHash) {
    const error = new Error('IzhGMU medicine-6 cycle component source identity is incomplete');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_SOURCE_INVALID';
    throw error;
  }
  return { parsed, group, fileName, fileHash };
}

function assertCandidateSourceBinding(plan, source) {
  const choices = Array.isArray(plan.candidate?.choices) ? plan.candidate.choices : [];
  if (choices.length !== 1) {
    const error = new Error('IzhGMU medicine-6 cycle elective plan must resolve exactly one slot');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_SINGLE_SLOT_REQUIRED';
    throw error;
  }
  const choice = choices[0];
  if (
    normalized(choice.sourceFile) !== source.fileName
    || normalizedHash(choice.sourceHash) !== source.fileHash
    || !normalized(choice.sourceReference)
  ) {
    const error = new Error('IzhGMU medicine-6 cycle elective choice is not bound to the exact component source');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_SOURCE_BINDING_MISMATCH';
    throw error;
  }
  const planSources = Array.isArray(plan.candidateSources) ? plan.candidateSources : [];
  const sourceEntry = planSources.find((item) => (
    normalized(item.fileName) === source.fileName
    && normalizedHash(item.sha256) === source.fileHash
    && Array.isArray(item.sourceReference)
    && item.sourceReference.map(normalized).includes(normalized(choice.sourceReference))
  ));
  if (!sourceEntry) {
    const error = new Error('IzhGMU medicine-6 cycle choice source reference is not present in the approved plan');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_PLAN_SOURCE_REFERENCE_MISMATCH';
    throw error;
  }
  return {
    slot: Number(choice.slot),
    alternative: normalized(choice.alternative),
    sourceReference: normalized(choice.sourceReference),
  };
}

function assertTargetBlocker(beforeBlockers, plan) {
  if (!Array.isArray(beforeBlockers)) throw new TypeError('medicine-6 beforeBlockers must be an array');
  const matches = beforeBlockers.filter((blocker) => (
    fingerprintIzhgmuMedicine6ResolutionBlocker(blocker) === plan.blockerFingerprint
  ));
  if (matches.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 target blocker must exist exactly once before rematerialization: ${matches.length}`);
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_TARGET_BLOCKER_STALE';
    throw error;
  }
  return matches[0];
}

function targetChoice(parsed, choice) {
  if (!Number.isInteger(choice.slot) || choice.slot <= 0 || !choice.alternative) {
    const error = new Error('IzhGMU medicine-6 cycle elective choice is malformed');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_CHOICE_INVALID';
    throw error;
  }
  const electiveChoices = Array.isArray(parsed.electiveChoices) ? parsed.electiveChoices : [];
  const matches = electiveChoices.filter((item) => Number(item?.slot) === choice.slot);
  if (matches.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 elective slot ${choice.slot} is not unique in parsed source`);
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_SLOT_NOT_UNIQUE';
    throw error;
  }
  const sourceChoice = matches[0];
  const alternatives = Array.isArray(sourceChoice.alternatives) ? sourceChoice.alternatives : [];
  const matchingAlternatives = alternatives.filter((item) => normalized(item?.discipline) === choice.alternative);
  if (matchingAlternatives.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 chosen elective alternative is not unique in source slot ${choice.slot}`);
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_ALTERNATIVE_NOT_SOURCE_BOUND';
    error.slot = choice.slot;
    error.alternative = choice.alternative;
    throw error;
  }
  return { sourceChoice, alternative: matchingAlternatives[0] };
}

function targetReview(parsed, sourceChoice) {
  const reviews = Array.isArray(parsed.reviewRequired) ? parsed.reviewRequired : [];
  const matches = reviews.filter((item) => (
    item?.warning === 'elective_choice_required'
    && Number(item?.electiveSlot) === Number(sourceChoice.slot)
    && normalized(item?.discipline) === normalized(sourceChoice.discipline)
  ));
  if (matches.length !== 1) {
    const error = new Error(`IzhGMU medicine-6 elective review blocker is not unique for slot ${sourceChoice.slot}`);
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_REVIEW_NOT_UNIQUE';
    throw error;
  }
  return matches[0];
}

function sourceGroupSpanGroups(parsed) {
  const match = normalized(parsed?.sourceGroupSpan).match(/^(\d{3})\s*[-–]\s*(\d{3})$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end < start || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function referenceList({ parsed, sourceChoice, alternative, selectedSourceReference }) {
  const values = [];
  const push = (role, range) => {
    const normalizedRange = normalized(range);
    if (!normalizedRange) return;
    const key = `${role}|${normalizedRange}`;
    if (!values.some((item) => `${item.role}|${item.range}` === key)) values.push({ role, range: normalizedRange });
  };
  push('discipline', sourceChoice.reference);
  push('note', sourceChoice.sectionReference);
  push('note', alternative?.reference);
  push('department', alternative?.departmentReference);
  push('location', alternative?.locationReference);
  push('time', alternative?.timeReference);
  push('note', selectedSourceReference);
  const groupRowReference = normalized(parsed?.sourceGroupRowReference);
  if (groupRowReference) push('group_span', groupRowReference);
  return values;
}

function materializedSeries({ parsed, group, sourceChoice, alternative, selectedSourceReference }) {
  const dates = Array.isArray(sourceChoice.dates) ? [...new Set(sourceChoice.dates.map(normalized).filter(Boolean))] : [];
  const startTime = normalized(sourceChoice.startTime);
  const endTime = normalized(sourceChoice.endTime);
  if (!dates.length || !startTime || !endTime) {
    const error = new Error('IzhGMU medicine-6 elective source slot lacks exact dates or time');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_SLOT_TIME_OR_DATES_MISSING';
    throw error;
  }
  const jointGroups = sourceGroupSpanGroups(parsed).filter((value) => value !== group);
  const location = normalized(alternative?.location) || null;
  const department = normalized(alternative?.department) || null;
  const assessment = normalized(sourceChoice?.assessment) || normalized(alternative?.assessment) || null;
  const rawSource = [
    `ДВ${sourceChoice.slot}`,
    normalized(alternative?.discipline),
    department,
    startTime && endTime ? `${startTime}-${endTime}` : null,
    assessment,
    location,
  ].filter(Boolean).join(' | ');
  return {
    sourceRole: 'class',
    sourceSheet: normalized(parsed.sourceSheet),
    group,
    sourceGroupSpan: normalized(parsed.sourceGroupSpan) || null,
    discipline: normalized(alternative.discipline),
    disciplineRaw: normalized(alternative.discipline),
    lessonType: { raw: 'практические занятия', code: 'practice' },
    dates,
    startTime,
    endTime,
    sourceTimeSlots: clone(sourceChoice.sourceTimeSlots || []),
    department,
    assessment,
    location,
    jointGroups,
    electiveSlot: Number(sourceChoice.slot),
    selectedByExplicitStudentChoice: true,
    status: 'ok',
    warning: null,
    warnings: [],
    ruleIds: ['IZH-C17', 'IZH-C18', 'IZH-R51', 'IZH-R52', 'IZH-R53'],
    references: referenceList({ parsed, sourceChoice, alternative, selectedSourceReference }),
    rawSource,
  };
}

function rematerializedParsed(parsed, { review, series }) {
  const next = clone(parsed);
  const beforeCount = next.reviewRequired.length;
  next.reviewRequired = next.reviewRequired.filter((item) => item !== next.reviewRequired.find((candidate) => (
    candidate?.warning === review.warning
    && Number(candidate?.electiveSlot) === Number(review.electiveSlot)
    && normalized(candidate?.discipline) === normalized(review.discipline)
  )));
  if (next.reviewRequired.length !== beforeCount - 1) {
    const error = new Error('IzhGMU medicine-6 cycle rematerializer did not remove exactly one source review item');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_REVIEW_TRANSITION_INVALID';
    throw error;
  }
  next.series = [...(next.series || []), series];
  next.publishable = next.reviewRequired.length === 0;
  next.rematerialization = {
    mode: 'explicit_student_choice',
    slot: series.electiveSlot,
    discipline: series.discipline,
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
    const error = new Error('IzhGMU medicine-6 cycle rematerializer blocker transition is not exactly one');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_BLOCKER_TRANSITION_INVALID';
    throw error;
  }
  return next;
}

export function executeIzhgmuMedicine6CycleElectiveRematerialization({
  plan,
  component,
  beforeBlockers,
} = {}) {
  assertPlan(plan);
  const source = assertComponent(component, plan);
  assertTargetBlocker(beforeBlockers, plan);
  const choice = assertCandidateSourceBinding(plan, source);
  const selected = targetChoice(source.parsed, choice);
  const review = targetReview(source.parsed, selected.sourceChoice);

  const beforeParsed = clone(source.parsed);
  const beforeBatch = buildIzhgmuCycleQaCandidate({
    parsed: beforeParsed,
    metadata: clone(component.metadata),
    source: clone(component.source),
  });
  const resolvedSeries = materializedSeries({
    parsed: source.parsed,
    group: source.group,
    sourceChoice: selected.sourceChoice,
    alternative: selected.alternative,
    selectedSourceReference: choice.sourceReference,
  });
  const afterParsed = rematerializedParsed(source.parsed, { review, series: resolvedSeries });
  const afterBatch = buildIzhgmuCycleQaCandidate({
    parsed: afterParsed,
    metadata: clone(component.metadata),
    source: clone(component.source),
  });
  const nextBlockers = afterBlockers(beforeBlockers, plan);
  const delta = eventDelta(beforeBatch.events, afterBatch.events);
  if (delta.removed.length !== 0 || delta.added.length !== resolvedSeries.dates.length) {
    const error = new Error('IzhGMU medicine-6 cycle elective rematerialization produced an unexpected event delta');
    error.code = 'IZH_M6_CYCLE_REMATERIALIZER_EVENT_DELTA_INVALID';
    error.expectedAdded = resolvedSeries.dates.length;
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
      sourceComponent: 'cycle',
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
    productionSemantics: 'pure_cycle_candidate_only_no_persistent_write',
  };
}
