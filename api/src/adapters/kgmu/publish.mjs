import { normalizeAcademicYear, scheduleStorageKey } from "../../order-context.js";

function validSourceHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function officialSource(schedule) {
  return (Array.isArray(schedule?.sources) ? schedule.sources : [])
    .find((source) => source?.type === "official-xlsx" && validSourceHash(source?.sha256)) || null;
}

export function scheduleObjectKey(schedule) {
  const university = String(schedule?.university || "").trim();
  const program = String(schedule?.program || "").trim();
  const course = Number(schedule?.course);
  const groupId = String(schedule?.group?.id || "").trim();
  const academicYear = normalizeAcademicYear(schedule?.academicYear);
  const semester = Number(schedule?.semester);
  if (
    university !== "kgmu" ||
    !program ||
    !Number.isInteger(course) ||
    course < 1 ||
    !groupId ||
    !academicYear ||
    ![1, 2].includes(semester)
  ) {
    throw new Error("Schedule is missing KGMU publication context or period");
  }
  return scheduleStorageKey({ ...schedule, academicYear, semester });
}

export function publicationDecision(schedule) {
  const group = String(schedule?.group?.code || "").trim();
  const events = Array.isArray(schedule?.events) ? schedule.events : [];
  const qa = schedule?.qa || {};

  if (schedule?.university !== "kgmu") return { publish: false, reason: "wrong-university" };
  if (!group) return { publish: false, reason: "missing-group" };

  // Archive/reference schedules may be useful for parser QA but can never obtain
  // a publication key or enter the commercial offer.
  if (qa.archiveReferenceOnly === true || qa.commercialTargetPeriod !== true) {
    return { publish: false, reason: "archive-reference" };
  }

  // The Python normalizer is the single source of truth for event construction.
  // This layer only accepts schedules that it marked fully QA-passed/publishable.
  if (qa.passed !== true || schedule?.publishable !== true) {
    return { publish: false, reason: "parser-qa-blocked" };
  }
  if (!events.length) return { publish: false, reason: "empty-schedule" };

  const source = officialSource(schedule);
  if (!source) return { publish: false, reason: "missing-official-source-hash" };
  if (!events.every((event) => event?.sourceType === "official-xlsx")) {
    return { publish: false, reason: "untrusted-events" };
  }

  try {
    return {
      publish: true,
      reason: "verified-dry-run",
      key: scheduleObjectKey(schedule),
      sourceSha256: source.sha256,
    };
  } catch {
    return { publish: false, reason: "missing-publication-period" };
  }
}

export function buildKgmuPublicationPlan(schedules = []) {
  if (!Array.isArray(schedules)) throw new Error("KGMU schedules must be an array");
  const entries = schedules.map((schedule) => {
    const decision = publicationDecision(schedule);
    return {
      group: String(schedule?.group?.code || ""),
      ...decision,
      schedule,
    };
  });
  return {
    version: 1,
    university: "kgmu",
    generatedAt: new Date().toISOString(),
    dryRun: true,
    publishable: entries.filter((entry) => entry.publish),
    blocked: entries.filter((entry) => !entry.publish),
  };
}
