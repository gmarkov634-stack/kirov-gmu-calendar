import {
  UGMU_SELLABLE_GROUPS,
  ugmuSellableContextAllowed,
} from "./ugmu-access-catalog.mjs";

function normalizeText(value) {
  return String(value ?? "").trim();
}

// Compatibility exports for existing first-course QA/staging code. Keep the
// legacy object shape stable while runtime checkout/trial validation delegates
// to the scalable sellable catalog.
export const UGMU_COURSE1_GROUPS = Object.freeze(
  UGMU_SELLABLE_GROUPS
    .filter((group) => group.program === "medicine" && group.course === 1)
    .map((group) => Object.freeze({
      university: group.university,
      program: group.program,
      course: group.course,
      stream: group.stream,
      groupCode: group.groupCode,
      groupId: group.groupId,
    })),
);

export const UGMU_COURSE1_STREAMS = Object.freeze([
  Object.freeze({ id: "1", first: 101, last: 112 }),
  Object.freeze({ id: "2", first: 113, last: 124 }),
  Object.freeze({ id: "3", first: 125, last: 136 }),
  Object.freeze({ id: "4", first: 137, last: 150 }),
]);

export const UGMU_COURSE1_GROUP_CODES = Object.freeze(
  UGMU_COURSE1_GROUPS.map((group) => group.groupCode),
);

const GROUP_BY_CODE = new Map(
  UGMU_COURSE1_GROUPS.map((group) => [group.groupCode, group]),
);

export function ugmuCourse1GroupByCode(value) {
  return GROUP_BY_CODE.get(normalizeText(value)) || null;
}

export function ugmuCourse1ContextAllowed(context = {}) {
  return ugmuSellableContextAllowed(context);
}
