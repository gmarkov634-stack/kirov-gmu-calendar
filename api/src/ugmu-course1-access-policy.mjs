import {
  UGMU_ACCESS_GROUPS,
  UGMU_ACCESS_SCOPES,
  ugmuCheckoutContextAllowed,
} from "./ugmu-access-catalog.mjs";

function normalizeText(value) {
  return String(value ?? "").trim();
}

const COURSE1_SCOPE = UGMU_ACCESS_SCOPES.find(
  (scope) => scope.program === "medicine" && scope.course === 1,
);

export const UGMU_COURSE1_STREAMS = COURSE1_SCOPE?.streams || Object.freeze([]);

// Keep the legacy course-1 export byte-for-byte compatible in shape with its
// original public contract. Scope metadata/capabilities live only in the new
// generic UGMU access catalog.
export const UGMU_COURSE1_GROUPS = Object.freeze(
  UGMU_ACCESS_GROUPS
    .filter((group) => group.program === "medicine" && group.course === 1)
    .map(({ university, program, course, stream, groupCode, groupId }) => Object.freeze({
      university,
      program,
      course,
      stream,
      groupCode,
      groupId,
    })),
);

export const UGMU_COURSE1_GROUP_CODES = Object.freeze(
  UGMU_COURSE1_GROUPS.map((group) => group.groupCode),
);

const GROUP_BY_CODE = new Map(
  UGMU_COURSE1_GROUPS.map((group) => [group.groupCode, group]),
);

export function ugmuCourse1GroupByCode(value) {
  return GROUP_BY_CODE.get(normalizeText(value)) || null;
}

// Compatibility export for existing checkout callers. The actual authority is
// the capability-aware UGMU access catalog, so adding a reviewed future scope
// does not require changing the payment route itself.
export function ugmuCourse1ContextAllowed(context = {}) {
  return ugmuCheckoutContextAllowed(context);
}
