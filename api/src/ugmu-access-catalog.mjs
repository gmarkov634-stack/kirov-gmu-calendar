function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUniversity(value) {
  return normalizeText(value).toLowerCase();
}

function numericGroupRange({ prefix, first, last, stream }) {
  return Array.from({ length: last - first + 1 }, (_, index) => ({
    code: `${prefix} ${first + index}`,
    stream: String(stream),
  }));
}

const COURSE1_MEDICINE_GROUPS = Object.freeze([
  ...numericGroupRange({ prefix: "ОЛД", first: 101, last: 112, stream: 1 }),
  ...numericGroupRange({ prefix: "ОЛД", first: 113, last: 124, stream: 2 }),
  ...numericGroupRange({ prefix: "ОЛД", first: 125, last: 136, stream: 3 }),
  ...numericGroupRange({ prefix: "ОЛД", first: 137, last: 150, stream: 4 }),
].map(Object.freeze));

// This registry is the sellable-scope boundary, not a runtime launch toggle.
// New faculties/programs/courses are added here only after their source/QA/storage
// gate is approved. Runtime flags still decide whether checkout/trials are open.
export const UGMU_SELLABLE_SCOPES = Object.freeze([
  Object.freeze({
    id: "medicine-course-1",
    university: "ugmu",
    faculty: null,
    program: "medicine",
    course: 1,
    groups: COURSE1_MEDICINE_GROUPS,
  }),
]);

export const UGMU_SELLABLE_GROUPS = Object.freeze(
  UGMU_SELLABLE_SCOPES.flatMap((scope) =>
    scope.groups.map((item) => Object.freeze({
      university: scope.university,
      faculty: scope.faculty,
      program: scope.program,
      course: scope.course,
      stream: item.stream,
      groupCode: item.code,
      groupId: `${scope.university}:${scope.program}:${scope.course}:stream-${item.stream}:${item.code}`,
      scopeId: scope.id,
    })),
  ),
);

const GROUP_BY_CONTEXT = new Map(
  UGMU_SELLABLE_GROUPS.map((group) => [
    `${group.program}\u0000${group.course}\u0000${group.groupCode}`,
    group,
  ]),
);

export function ugmuSellableGroup({ program, course, groupCode } = {}) {
  const key = `${normalizeText(program)}\u0000${Number(course)}\u0000${normalizeText(groupCode)}`;
  return GROUP_BY_CONTEXT.get(key) || null;
}

export function ugmuSellableContextAllowed(context = {}) {
  if (normalizeUniversity(context.university) !== "ugmu") return false;

  const group = ugmuSellableGroup(context);
  if (!group) return false;
  if (normalizeText(context.stream) !== group.stream) return false;
  if (normalizeText(context.groupId) !== group.groupId) return false;

  // Faculty is optional in the current order contract. Once a scope has a
  // confirmed faculty id, a supplied faculty must match it exactly.
  if (group.faculty && context.faculty != null && normalizeText(context.faculty) !== group.faculty) return false;
  return true;
}
