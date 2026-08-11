import { createHash } from "node:crypto";
import { normalizeAcademicYear } from "../../order-context.js";
import { publicationDecision } from "./publish.mjs";

function validScheduleKey(value) {
  return typeof value === "string" &&
    value.startsWith("schedules/kgmu/") &&
    !value.includes("..") &&
    !value.includes("\\");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildKgmuS3WriteSet(plan, { academicYear, semester } = {}) {
  const expectedAcademicYear = normalizeAcademicYear(academicYear);
  const expectedSemester = Number(semester);

  if (!expectedAcademicYear) throw new Error("invalid-expected-academic-year");
  if (![1, 2].includes(expectedSemester)) throw new Error("invalid-expected-semester");
  if (!plan || plan.version !== 1 || plan.university !== "kgmu" || plan.dryRun !== true) {
    throw new Error("invalid-kgmu-publication-plan");
  }
  if (!Array.isArray(plan.publishable) || !Array.isArray(plan.blocked)) {
    throw new Error("invalid-kgmu-publication-plan-entries");
  }

  const seenKeys = new Set();
  const objects = [];

  for (const entry of plan.publishable) {
    const schedule = entry?.schedule;
    const group = String(entry?.group || "").trim();
    if (!schedule || !group || group !== String(schedule?.group?.code || "").trim()) {
      throw new Error("publication-entry-group-mismatch");
    }

    const actualAcademicYear = normalizeAcademicYear(schedule.academicYear);
    const actualSemester = Number(schedule.semester);
    if (actualAcademicYear !== expectedAcademicYear || actualSemester !== expectedSemester) {
      throw new Error(`publication-period-mismatch:${group}`);
    }

    const decision = publicationDecision(schedule);
    if (!decision.publish) throw new Error(`publication-revalidation-failed:${group}:${decision.reason}`);
    if (!validScheduleKey(entry.key) || entry.key !== decision.key) {
      throw new Error(`publication-key-mismatch:${group}`);
    }
    if (!entry.sourceSha256 || entry.sourceSha256 !== decision.sourceSha256) {
      throw new Error(`publication-source-hash-mismatch:${group}`);
    }
    if (seenKeys.has(entry.key)) throw new Error(`duplicate-publication-key:${entry.key}`);
    seenKeys.add(entry.key);

    const bodyText = stableJson(schedule);
    const bodySha256 = createHash("sha256").update(bodyText).digest("hex");
    objects.push({
      group,
      key: entry.key,
      sourceSha256: decision.sourceSha256,
      bodySha256,
      eventCount: schedule.events.length,
      bodyText,
      schedule,
    });
  }

  return {
    version: 1,
    university: "kgmu",
    expectedAcademicYear,
    expectedSemester,
    blockedCount: plan.blocked.length,
    objects,
  };
}
