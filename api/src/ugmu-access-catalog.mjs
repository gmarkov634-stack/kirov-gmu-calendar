const SCOPE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "medicine-1-2026-autumn",
    program: "medicine",
    course: 1,
    capabilities: Object.freeze({ checkout: true, trial: true }),
    streams: Object.freeze([
      Object.freeze({ id: "1", first: 101, last: 112 }),
      Object.freeze({ id: "2", first: 113, last: 124 }),
      Object.freeze({ id: "3", first: 125, last: 136 }),
      Object.freeze({ id: "4", first: 137, last: 150 }),
    ]),
  }),
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUniversity(value) {
  return normalizeText(value).toLowerCase();
}

function contextKey(program, course, groupCode) {
  return `${program}\u0000${course}\u0000${groupCode}`;
}

export const UGMU_ACCESS_SCOPES = SCOPE_DEFINITIONS;

export const UGMU_ACCESS_GROUPS = Object.freeze(
  SCOPE_DEFINITIONS.flatMap((scope) =>
    scope.streams.flatMap((stream) =>
      Array.from({ length: stream.last - stream.first + 1 }, (_, index) => {
        const groupCode = `ОЛД ${stream.first + index}`;
        return Object.freeze({
          scopeId: scope.id,
          university: "ugmu",
          program: scope.program,
          course: scope.course,
          stream: stream.id,
          groupCode,
          groupId: `ugmu:${scope.program}:${scope.course}:stream-${stream.id}:${groupCode}`,
        });
      }),
    ),
  ),
);

const SCOPE_BY_ID = new Map(SCOPE_DEFINITIONS.map((scope) => [scope.id, scope]));
const GROUP_BY_CONTEXT = new Map(
  UGMU_ACCESS_GROUPS.map((group) => [
    contextKey(group.program, group.course, group.groupCode),
    group,
  ]),
);

export function ugmuAccessGroup(context = {}) {
  if (normalizeUniversity(context.university) !== "ugmu") return null;
  const program = normalizeText(context.program);
  const course = Number(context.course);
  const groupCode = normalizeText(context.groupCode);
  if (!program || !Number.isInteger(course) || course < 1 || !groupCode) return null;
  return GROUP_BY_CONTEXT.get(contextKey(program, course, groupCode)) || null;
}

export function ugmuAccessContextAllowed(context = {}, capability = "") {
  const group = ugmuAccessGroup(context);
  if (!group) return false;
  if (normalizeText(context.stream) !== group.stream) return false;
  if (normalizeText(context.groupId) !== group.groupId) return false;

  const requestedCapability = normalizeText(capability);
  if (!requestedCapability) return true;
  const scope = SCOPE_BY_ID.get(group.scopeId);
  return scope?.capabilities?.[requestedCapability] === true;
}

export function ugmuCheckoutContextAllowed(context = {}) {
  return ugmuAccessContextAllowed(context, "checkout");
}

export function ugmuTrialContextAllowed(context = {}) {
  return ugmuAccessContextAllowed(context, "trial");
}
