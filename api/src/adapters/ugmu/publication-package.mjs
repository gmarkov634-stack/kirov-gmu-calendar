import { createHash } from "node:crypto";

import { canonicalizeUgmuWeeklyPilot } from "./canonical.mjs";
import { prepareSchedulePublication } from "../../schedule/pipeline.js";

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function requirePilot(raw) {
  if (raw?.university !== "ugmu" || raw?.group?.code !== "ОЛД 101") {
    throw new Error("UGMU publication package is fail-closed to ОЛД 101");
  }
  if (raw?.sourceReview?.status !== "semantic-reviewed-pilot") {
    throw new Error("UGMU pilot must pass semantic review before packaging");
  }
  if (raw?.sourceReview?.publicationAllowed !== false) {
    throw new Error("UGMU pilot source boundary must remain fail-closed");
  }
}

function deterministicEventId(_event, index) {
  return `evt_ugmu_old101_${String(index + 1).padStart(4, "0")}`;
}

export function buildUgmuPilotPublicationPackage(raw, options = {}) {
  requirePilot(raw);
  const canonical = canonicalizeUgmuWeeklyPilot(raw);
  const now = options.now || "2026-08-20T17:15:00.000Z";
  const versionId = options.versionId || "ver_ugmu_old101_current";
  const prepared = prepareSchedulePublication(canonical, {
    now,
    eventIdFactory: options.eventIdFactory || deterministicEventId,
    versionIdFactory: () => versionId,
    postprocessOptions: {
      includeServiceSignature: false,
      longBreakDays: 14,
    },
  });

  const schedule = prepared.batch.schedule;
  const context = prepared.context;
  const scheduleFile = `versions/${schedule.schedule_version_id}.json`;
  const icsFile = "calendar.ics";
  const sourceSha256 = raw.sources?.[0]?.sha256 || null;
  const icsSha256 = sha256Text(prepared.ics);
  const generatedAt = schedule.version_created_at;

  const current = {
    version: 1,
    kind: "schedule-current-pointer",
    university: "ugmu",
    program: context.program,
    course: context.course,
    stream: context.stream,
    groupId: context.groupId,
    groupCode: context.groupCode,
    groupDisplayName: context.groupDisplayName,
    academicYear: context.academicYear,
    semester: context.semester,
    scheduleVersionId: schedule.schedule_version_id,
    previousScheduleVersionId: schedule.previous_schedule_version_id,
    contentFingerprint: schedule.content_fingerprint,
    sourceSha256,
    eventCount: prepared.batch.events.length,
    generatedAt,
    files: {
      schedule: scheduleFile,
      ics: icsFile,
    },
    hashes: {
      icsSha256,
    },
    qa: {
      inputPublishable: prepared.inputQa.publishable,
      outputPublishable: prepared.outputQa.publishable,
    },
    state: "qa-approved-fail-closed",
    publicationAllowed: false,
    active: false,
    catalogVisible: false,
    checkoutEnabled: false,
    salesEnabled: false,
  };

  const catalog = {
    version: 1,
    university: "ugmu",
    timezone: "Asia/Yekaterinburg",
    mode: "internal-fail-closed",
    generatedAt,
    groupCount: 1,
    groups: [{
      id: context.groupId,
      university: "ugmu",
      program: context.program,
      course: context.course,
      stream: context.stream,
      code: context.groupCode,
      displayName: context.groupDisplayName,
      timezone: "Asia/Yekaterinburg",
      academicYear: context.academicYear,
      semester: context.semester,
      scheduleVersionId: schedule.schedule_version_id,
      currentPointer: "current.json",
      eventCount: prepared.batch.events.length,
      qaStatus: "approved",
      calendarReady: true,
      active: false,
      public: false,
      checkoutEnabled: false,
      salesEnabled: false,
    }],
  };

  const report = {
    version: 1,
    university: "ugmu",
    group: context.groupCode,
    sourceSha256,
    scheduleVersionId: schedule.schedule_version_id,
    contentFingerprint: schedule.content_fingerprint,
    eventCount: prepared.batch.events.length,
    icsBytes: Buffer.byteLength(prepared.ics, "utf8"),
    icsSha256,
    inputQa: prepared.inputQa.publishable,
    outputQa: prepared.outputQa.publishable,
    currentPointerValid: current.scheduleVersionId === schedule.schedule_version_id,
    catalogPointerValid: catalog.groups[0].scheduleVersionId === current.scheduleVersionId,
    failClosed: [
      current.publicationAllowed === false,
      current.active === false,
      current.catalogVisible === false,
      current.checkoutEnabled === false,
      current.salesEnabled === false,
      catalog.groups[0].active === false,
      catalog.groups[0].public === false,
      catalog.groups[0].checkoutEnabled === false,
      catalog.groups[0].salesEnabled === false,
    ].every(Boolean),
    publicationAllowed: false,
    nextGate: "expand-weekly-grid-to-first-stream",
  };

  return {
    batch: prepared.batch,
    ics: prepared.ics,
    current,
    catalog,
    report,
    files: {
      schedule: scheduleFile,
      ics: icsFile,
      current: "current.json",
      catalog: "live-catalog.json",
      report: "package-report.json",
    },
  };
}
