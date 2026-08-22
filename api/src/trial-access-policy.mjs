import { universityTrialsEnabled } from "./university-commerce-policy.mjs";
import {
  UGMU_ACCESS_GROUPS,
  ugmuTrialContextAllowed,
} from "./ugmu-access-catalog.mjs";

const UGMU_FIRST_STREAM_GROUPS = Object.freeze(
  UGMU_ACCESS_GROUPS
    .filter((group) => group.program === "medicine" && group.course === 1 && group.stream === "1")
    .map((group) => group.groupCode),
);

function normalizedUniversity(value) {
  return String(value || "").trim().toLowerCase();
}

export function ugmuTrialScopeAllowed(context = {}) {
  return ugmuTrialContextAllowed(context);
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
