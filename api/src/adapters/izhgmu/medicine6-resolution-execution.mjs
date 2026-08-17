import { classifyIzhgmuMedicine6Blocker } from './medicine6-blocker-resolution.mjs';

const PROPOSAL_KIND = Object.freeze({
  OFFICIAL_SOURCE: 'official_source_evidence',
  STUDENT_CHOICE: 'student_choice',
});

function normalized(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return /^[a-f0-9]{64}$/i.test(normalized(value)) ? normalized(value).toLowerCase() : null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function blockerGroup(blocker) {
  const value = normalized(blocker?.group);
  return value || null;
}

function requiredElectiveSlots(blocker) {
  const explicit = Array.isArray(blocker?.slots)
    ? blocker.slots.map(Number).filter((slot) => Number.isInteger(slot) && slot > 0)
    : [];
  if (explicit.length) return [...new Set(explicit)].sort((a, b) => a - b);
  const discipline = normalized(blocker?.discipline);
  const match = discipline.match(/(?:выбору|ДВ)\s*(\d+)$/i);
  return match ? [Number(match[1])] : [];
}

function rejected(blocker, classification, reason, details = {}) {
  return {
    status: 'rejected',
    reason,
    resolutionClass: classification.resolutionClass,
    blocker: clone(blocker),
    proposalAccepted: false,
    clearsBlocker: false,
    automaticApplyAllowed: false,
    requiresExplicitApply: false,
    ...details,
  };
}

function assertProposalObject(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new TypeError('medicine-6 resolution proposal must be an object');
  }
}

function evaluateOfficialSource(blocker, classification, proposal) {
  if (proposal.kind !== PROPOSAL_KIND.OFFICIAL_SOURCE) {
    return rejected(blocker, classification, 'resolution_class_mismatch');
  }
  const source = proposal.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return rejected(blocker, classification, 'official_source_evidence_missing');
  }
  const sourceHash = sha256(source.sha256);
  const sourceFile = normalized(source.fileName);
  const sourceUrl = normalized(source.url);
  const references = Array.isArray(source.references)
    ? source.references.map(normalized).filter(Boolean)
    : [];
  if (!sourceHash || !sourceFile || !sourceUrl || references.length === 0) {
    return rejected(blocker, classification, 'official_source_evidence_incomplete');
  }

  const candidate = {
    status: proposal.reviewed === true ? 'ready_for_explicit_apply' : 'review_required',
    reason: proposal.reviewed === true ? null : 'source_bound_semantic_review_required',
    resolutionClass: classification.resolutionClass,
    blocker: clone(blocker),
    proposalAccepted: true,
    clearsBlocker: false,
    automaticApplyAllowed: false,
    requiresExplicitApply: proposal.reviewed === true,
    candidate: {
      kind: PROPOSAL_KIND.OFFICIAL_SOURCE,
      source: {
        fileName: sourceFile,
        url: sourceUrl,
        sha256: sourceHash,
        references: [...new Set(references)],
      },
      reviewed: proposal.reviewed === true,
      reviewReference: normalized(proposal.reviewReference) || null,
      proposedFact: clone(proposal.proposedFact ?? null),
    },
  };
  if (candidate.status === 'ready_for_explicit_apply' && !candidate.candidate.reviewReference) {
    return rejected(blocker, classification, 'review_reference_required_for_explicit_apply_candidate');
  }
  return candidate;
}

function normalizeChoices(choices) {
  if (!Array.isArray(choices)) return [];
  return choices.map((choice) => ({
    slot: Number(choice?.slot),
    alternative: normalized(choice?.alternative),
    sourceFile: normalized(choice?.sourceFile),
    sourceHash: sha256(choice?.sourceHash),
    sourceReference: normalized(choice?.sourceReference),
  }));
}

function evaluateStudentChoice(blocker, classification, proposal) {
  if (proposal.kind !== PROPOSAL_KIND.STUDENT_CHOICE) {
    return rejected(blocker, classification, 'resolution_class_mismatch');
  }
  if (proposal.explicit !== true) {
    return rejected(blocker, classification, 'explicit_student_choice_required');
  }
  const group = normalized(proposal.group);
  if (!/^6(?:0[1-9]|[12]\d|30)$/.test(group)) {
    return rejected(blocker, classification, 'medicine6_group_required');
  }
  const expectedGroup = blockerGroup(blocker);
  if (expectedGroup && expectedGroup !== group) {
    return rejected(blocker, classification, 'student_choice_group_mismatch', { expectedGroup, observedGroup: group });
  }

  const requiredSlots = requiredElectiveSlots(blocker);
  if (requiredSlots.length === 0) {
    return rejected(blocker, classification, 'elective_slot_not_source_bound');
  }
  const choices = normalizeChoices(proposal.choices);
  const chosenSlots = choices.map((choice) => choice.slot).sort((a, b) => a - b);
  if (
    choices.length !== requiredSlots.length
    || new Set(chosenSlots).size !== chosenSlots.length
    || requiredSlots.some((slot, index) => chosenSlots[index] !== slot)
  ) {
    return rejected(blocker, classification, 'student_choice_slot_coverage_mismatch', { requiredSlots, chosenSlots });
  }
  for (const choice of choices) {
    if (!choice.alternative || !choice.sourceFile || !choice.sourceHash || !choice.sourceReference) {
      return rejected(blocker, classification, 'student_choice_source_binding_incomplete');
    }
  }

  return {
    status: 'ready_for_explicit_apply',
    reason: null,
    resolutionClass: classification.resolutionClass,
    blocker: clone(blocker),
    proposalAccepted: true,
    clearsBlocker: false,
    automaticApplyAllowed: false,
    requiresExplicitApply: true,
    candidate: {
      kind: PROPOSAL_KIND.STUDENT_CHOICE,
      group,
      explicit: true,
      choiceReference: normalized(proposal.choiceReference) || null,
      choices,
    },
  };
}

export function evaluateIzhgmuMedicine6ResolutionProposal(blocker, proposal) {
  const classification = classifyIzhgmuMedicine6Blocker(blocker);
  assertProposalObject(proposal);
  if (classification.resolutionClass === 'unknown') {
    return rejected(blocker, classification, 'manual_review_required_for_unknown_blocker');
  }
  if (classification.resolutionClass === 'official_source_required') {
    return evaluateOfficialSource(blocker, classification, proposal);
  }
  if (classification.resolutionClass === 'student_choice_required') {
    return evaluateStudentChoice(blocker, classification, proposal);
  }
  return rejected(blocker, classification, 'unsupported_resolution_class');
}

export function buildIzhgmuMedicine6ResolutionExecutionPlan(blockers = []) {
  if (!Array.isArray(blockers)) throw new TypeError('medicine-6 blockers must be an array');
  const items = blockers.map((blocker, blockerIndex) => {
    const classification = classifyIzhgmuMedicine6Blocker(blocker);
    return {
      blockerIndex,
      sourceComponent: normalized(blocker?.source_component) || null,
      warning: normalized(blocker?.warning) || null,
      resolutionClass: classification.resolutionClass,
      automaticClearAllowed: false,
      evidenceArrivalClearsBlocker: false,
      requiresExplicitApply: classification.resolutionClass !== 'unknown',
      requiresManualReview: classification.requiresManualReview,
      requiredEvidence: classification.requiredEvidence,
    };
  });
  return {
    items,
    automaticClearCount: items.filter((item) => item.automaticClearAllowed).length,
    evidenceArrivalClearCount: items.filter((item) => item.evidenceArrivalClearsBlocker).length,
    explicitApplyRequiredCount: items.filter((item) => item.requiresExplicitApply).length,
    unknownCount: items.filter((item) => item.resolutionClass === 'unknown').length,
    productionSemantics: 'proposal_only_no_blocker_clearance',
  };
}

export const IZHGMU_MEDICINE6_RESOLUTION_PROPOSAL_KINDS = PROPOSAL_KIND;
