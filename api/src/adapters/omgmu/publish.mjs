import path from "node:path";

export const OMG_MU_MANUAL_REVIEW_GROUPS = new Set(["2113", "2114", "389", "393"]);

export function scheduleObjectKey(schedule) {
  const university = String(schedule?.university || "").trim();
  const program = String(schedule?.program || "").trim();
  const course = String(schedule?.course || "").trim();
  const groupId = String(schedule?.group?.id || "").trim();
  if (!university || !program || !course || !groupId) {
    throw new Error("Schedule is missing publication context");
  }
  return path.posix.join("schedules", university, program, course, `${encodeURIComponent(groupId)}.json`);
}

export function publicationDecision(schedule) {
  const group = String(schedule?.group?.code || "").trim();
  const events = Array.isArray(schedule?.events) ? schedule.events : [];
  if (!group) return { publish: false, reason: "missing-group" };
  if (!events.length) return { publish: false, reason: "empty-schedule" };

  if (OMG_MU_MANUAL_REVIEW_GROUPS.has(group)) {
    if (schedule?.review?.status !== "approved") return { publish: false, reason: "manual-review-pending" };
    if (!schedule?.review?.sourceSha256) return { publish: false, reason: "manual-review-missing-source-hash" };
    if (!events.every((event) => event?.sourceType === "manual-review")) {
      return { publish: false, reason: "manual-review-untrusted-events" };
    }
  }

  return { publish: true, reason: "verified", key: scheduleObjectKey(schedule) };
}

export function buildPublicationPlan(schedules) {
  const entries = schedules.map((schedule) => {
    const decision = publicationDecision(schedule);
    const entry = {
      group: String(schedule?.group?.code || ""),
      ...decision,
      schedule,
    };
    if (!entry.key) {
      try {
        entry.key = scheduleObjectKey(schedule);
      } catch {
        // Invalid schedules remain blocked without a storage key.
      }
    }
    return entry;
  });
  return {
    version: 1,
    university: "omgmu",
    generatedAt: new Date().toISOString(),
    publishable: entries.filter((entry) => entry.publish),
    blocked: entries.filter((entry) => !entry.publish),
  };
}
