const RESOLUTION_CLASS = Object.freeze({
  OFFICIAL_SOURCE: 'official_source_required',
  STUDENT_CHOICE: 'student_choice_required',
  UNKNOWN: 'unknown',
});

const KNOWN_RULES = Object.freeze({
  'cycle|elective_choice_required': Object.freeze({
    resolutionClass: RESOLUTION_CLASS.STUDENT_CHOICE,
    watchOfficialSource: false,
    requiresStudentChoice: true,
    requiredEvidence: 'Explicit student selection for the relevant medicine-6 elective slot. The parser must not choose an elective discipline from the listed alternatives.',
  }),
  'lecture|elective_choice_required': Object.freeze({
    resolutionClass: RESOLUTION_CLASS.STUDENT_CHOICE,
    watchOfficialSource: false,
    requiresStudentChoice: true,
    requiredEvidence: 'Explicit student selection for the relevant medicine-6 elective slot before elective lecture occurrences can be projected to that student calendar.',
  }),
  'lecture|stream_group_mapping_required': Object.freeze({
    resolutionClass: RESOLUTION_CLASS.OFFICIAL_SOURCE,
    watchOfficialSource: true,
    requiresStudentChoice: false,
    requiredEvidence: 'Official source evidence mapping medicine-6 groups 601-630 to communication-skills lecture streams 1 and 2.',
  }),
  'postsemester|end_time_missing_in_source': Object.freeze({
    resolutionClass: RESOLUTION_CLASS.OFFICIAL_SOURCE,
    watchOfficialSource: true,
    requiresStudentChoice: false,
    requiredEvidence: 'Official source evidence containing the exact state-exam end time or an exact duration from which the end time can be derived without approximation.',
  }),
  'postsemester|group_missing_from_reviewed_source': Object.freeze({
    resolutionClass: RESOLUTION_CLASS.OFFICIAL_SOURCE,
    watchOfficialSource: true,
    requiresStudentChoice: false,
    requiredEvidence: 'Official reviewed source evidence explicitly assigning the missing post-semester component date to the affected group.',
  }),
});

function normalized(value) {
  return String(value ?? '').trim();
}

function unknownResolution(blocker) {
  return {
    resolutionClass: RESOLUTION_CLASS.UNKNOWN,
    automaticResolution: false,
    watchOfficialSource: false,
    requiresStudentChoice: false,
    requiresManualReview: true,
    requiredEvidence: `Unreviewed blocker combination: ${normalized(blocker?.source_component) || '<missing-component>'}|${normalized(blocker?.warning) || '<missing-warning>'}. Add an explicit reviewed rule before any resolution is allowed.`,
    mayInfer: false,
  };
}

export function classifyIzhgmuMedicine6Blocker(blocker) {
  if (!blocker || typeof blocker !== 'object' || Array.isArray(blocker)) {
    throw new TypeError('medicine-6 blocker must be an object');
  }
  const sourceComponent = normalized(blocker.source_component);
  const warning = normalized(blocker.warning);
  const rule = KNOWN_RULES[`${sourceComponent}|${warning}`];
  if (!rule) return unknownResolution(blocker);
  return {
    ...rule,
    automaticResolution: false,
    requiresManualReview: false,
    mayInfer: false,
  };
}

export function classifyIzhgmuMedicine6Blockers(blockers = []) {
  if (!Array.isArray(blockers)) throw new TypeError('medicine-6 blockers must be an array');
  const items = blockers.map((blocker, index) => ({
    blockerIndex: index,
    sourceComponent: normalized(blocker.source_component) || null,
    warning: normalized(blocker.warning) || null,
    component: normalized(blocker.component) || null,
    discipline: normalized(blocker.discipline) || null,
    group: normalized(blocker.group) || null,
    ...classifyIzhgmuMedicine6Blocker(blocker),
  }));
  const counts = {
    [RESOLUTION_CLASS.OFFICIAL_SOURCE]: 0,
    [RESOLUTION_CLASS.STUDENT_CHOICE]: 0,
    [RESOLUTION_CLASS.UNKNOWN]: 0,
  };
  for (const item of items) counts[item.resolutionClass] += 1;
  return {
    items,
    counts,
    unknownCount: counts[RESOLUTION_CLASS.UNKNOWN],
    watchOfficialSource: items.some((item) => item.watchOfficialSource),
    requiresStudentChoice: items.some((item) => item.requiresStudentChoice),
    productionSemantics: 'diagnostic_only_blockers_remain_fail_closed',
  };
}

export const IZHGMU_MEDICINE6_BLOCKER_RESOLUTION_CLASSES = RESOLUTION_CLASS;
