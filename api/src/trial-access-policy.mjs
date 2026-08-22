import { universityTrialsEnabled } from "./university-commerce-policy.mjs";

const UGMU_FIRST_STREAM_GROUPS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`),
);
const UGMU_SECOND_STREAM_GROUPS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `ОЛД ${113 + index}`),
);
const UGMU_COURSE1_GROUPS_BY_STREAM = Object.freeze({
  "1": UGMU_FIRST_STREAM_GROUPS,
  "2": UGMU_SECOND_STREAM_GROUPS,
});

function normalizedUniversity(value) {
  return String(value || "").trim().toLowerCase();
}

export function ugmuTrialScopeAllowed(context = {}) {
  if (normalizedUniversity(context.university) !== "ugmu") return false;
  if (String(context.program || "").trim() !== "medicine") return false;
  if (Number(context.course) !== 1) return false;

  const stream = String(context.stream || "").trim();
  const allowedGroups = UGMU_COURSE1_GROUPS_BY_STREAM[stream];
  if (!allowedGroups) return false;

  const groupCode = String(context.groupCode || "").trim();
  if (!allowedGroups.includes(groupCode)) return false;

  const expectedGroupId = `ugmu:medicine:1:stream-${stream}:${groupCode}`;
  return String(context.groupId || "").trim() === expectedGroupId;
}

export function runtimeTrialContextAllowed(config = {}, context = {}) {
  const university = normalizedUniversity(context.university);
  if (!university) return false;

  if (university === "ugmu") {
    return config.ugmuTrialsEnabled === true && ugmuTrialScopeAllowed(context);
  }

  const globalTrialsEnabled = config.globalTrialsEnabled ?? config.trialsEnabled;
  return globalTrialsEnabled === true && universityTrialsEnabled(university);
}

export function trialServiceEnabled(config = {}) {
  if (typeof config.trialServiceEnabled === "boolean") return config.trialServiceEnabled;
  return config.trialsEnabled === true || config.ugmuTrialsEnabled === true;
}

export { UGMU_FIRST_STREAM_GROUPS, UGMU_SECOND_STREAM_GROUPS, UGMU_COURSE1_GROUPS_BY_STREAM };
