import { universityTrialsEnabled } from "./university-commerce-policy.mjs";
import {
  UGMU_COURSE1_GROUPS,
  ugmuCourse1ContextAllowed,
} from "./ugmu-course1-access-policy.mjs";

const UGMU_FIRST_STREAM_GROUPS = Object.freeze(
  UGMU_COURSE1_GROUPS
    .filter((group) => group.stream === "1")
    .map((group) => group.groupCode),
);

function normalizedUniversity(value) {
  return String(value || "").trim().toLowerCase();
}

export function ugmuTrialScopeAllowed(context = {}) {
  return ugmuCourse1ContextAllowed(context);
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

export { UGMU_FIRST_STREAM_GROUPS };
