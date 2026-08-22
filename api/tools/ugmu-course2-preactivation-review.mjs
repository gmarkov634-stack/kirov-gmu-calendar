#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { scheduleStorageKey } from "../src/order-context.js";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_GROUP_COUNT = 48;
const EXPECTED_EVENT_COUNT = 11056;
const PREACTIVATION_NOW = "2026-08-23T00:00:00.000Z";

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (match) values.set(match[1], match[2]);
  }
  if (!values.get("canonical-dir")) throw new Error("Missing --canonical-dir=...");
  if (!values.get("output-dir")) throw new Error("Missing --output-dir=...");
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function emptyDerived() {
  return {
    academic_week: null,
    sequence: { index: null, total: null, bucket: null },
    next_same_event: null,
    is_last_same_event: false,
    day: {
      index: null,
      total: null,
      remaining: null,
      next_event: null,
      gap_minutes: null,
      overlaps_next: false,
    },
    cycle: null,
    assessment: null,
  };
}

function cleanIncomingBatch(reviewed) {
  const incoming = structuredClone(reviewed);
  delete incoming.schedule.schedule_version_id;
  delete incoming.schedule.previous_schedule_version_id;
  delete incoming.schedule.content_fingerprint;
  delete incoming.schedule.version_created_at;
  incoming.schedule.generated_at = null;
  incoming.events = incoming.events.map((event) => ({
    ...event,
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    derived: emptyDerived(),
    calendar: {
      title: null,
      description: null,
      location: null,
    },
  }));
  return incoming;
}

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, "");
}

function icsPropertyValues(text, name) {
  const prefix = `${name}:`;
  return unfoldIcs(text)
    .split("\r\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

function countIcsComponents(text, component) {
  return unfoldIcs(text).split("\r\n").filter((line) => line === `BEGIN:${component}`).length;
}

function requirePhysicalLineLengths(text, group) {
  for (const line of text.split("\r\n")) {
    if (!line) continue;
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > 75) throw new Error(`${group}: ICS physical line exceeds 75 octets (${bytes})`);
  }
}

function coreEvent(event) {
  return {
    university: event.university,
    academic: event.academic,
    audience: event.audience,
    timing: event.timing,
    lesson: event.lesson,
    source: event.source,
    parse: event.parse,
  };
}

function requireReviewedBatch(batch, expectedGroup) {
  if (batch?.schema_version !== "1.0" || !batch?.schedule || !Array.isArray(batch?.events)) {
    throw new Error(`${expectedGroup}: invalid canonical review batch`);
  }
  if (batch.schedule.university_code !== "ugmu" || batch.schedule.faculty_code !== "medicine" || batch.schedule.course !== 2) {
    throw new Error(`${expectedGroup}: canonical review scope mismatch`);
  }
  if (batch.schedule.group !== expectedGroup) throw new Error(`${expectedGroup}: group mismatch`);
  if (!batch.schedule.schedule_version_id || !batch.schedule.content_fingerprint || !batch.schedule.version_created_at) {
    throw new Error(`${expectedGroup}: reviewed version metadata missing`);
  }
  if (batch.events.some((event) => !event?.system?.event_id || event?.system?.revision !== 1)) {
    throw new Error(`${expectedGroup}: reviewed event identity baseline is incomplete`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const canonicalDir = resolve(args.get("canonical-dir"));
  const outputDir = resolve(args.get("output-dir"));
  const icsDir = resolve(outputDir, "ics");
  const batchDir = resolve(outputDir, "batches");
  mkdirSync(icsDir, { recursive: true });
  mkdirSync(batchDir, { recursive: true });

  const files = readdirSync(canonicalDir)
    .filter((name) => /^ОЛД-\d+\.json$/u.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (files.length !== EXPECTED_GROUP_COUNT) throw new Error(`Expected ${EXPECTED_GROUP_COUNT} canonical group files, got ${files.length}`);

  const report = {
    version: 1,
    stage: "ics-preactivation-dry-run",
    university: "ugmu",
    program: "medicine",
    course: 2,
    groups: {},
    summary: {},
  };

  const globalEventIds = new Set();
  const globalUids = new Set();
  const storageKeys = new Set();
  const icsHashes = [];
  const storagePlan = [];
  let eventCount = 0;
  let inputQaPassedGroups = 0;
  let outputQaPassedGroups = 0;
  let versionStableGroups = 0;
  let contentFingerprintStableGroups = 0;
  let versionTimestampStableGroups = 0;
  let eventIdStableCount = 0;
  let eventFingerprintStableCount = 0;
  let eventRevisionStableCount = 0;
  let coreEventStableCount = 0;
  let uidValidatedCount = 0;
  let sequenceValidatedCount = 0;
  let icsBytesTotal = 0;

  for (let index = 0; index < files.length; index += 1) {
    const expectedGroup = EXPECTED_GROUPS[index];
    const reviewed = loadJson(resolve(canonicalDir, files[index]));
    requireReviewedBatch(reviewed, expectedGroup);
    const groupNumber = expectedGroup.match(/\d+/)?.[0];
    const stream = reviewed.events[0]?.audience?.stream;
    if (!stream || reviewed.events.some((event) => event?.audience?.stream !== stream)) {
      throw new Error(`${expectedGroup}: stream is missing or inconsistent`);
    }

    const incoming = cleanIncomingBatch(reviewed);
    const prepared = prepareSchedulePublication(incoming, {
      now: PREACTIVATION_NOW,
      eventIdFactory: (_event, eventIndex) => `evt_ugmu_c2_old${groupNumber}_${String(eventIndex + 1).padStart(4, "0")}`,
      versionIdFactory: () => `ver_ugmu_c2_old${groupNumber}_controlled_review`,
      postprocessOptions: {
        includeServiceSignature: false,
        longBreakDays: 14,
      },
    });

    if (!prepared.inputQa.publishable) throw new Error(`${expectedGroup}: publication input QA failed`);
    if (!prepared.outputQa.publishable) throw new Error(`${expectedGroup}: publication output QA failed`);
    inputQaPassedGroups += 1;
    outputQaPassedGroups += 1;

    const context = prepared.context;
    const expectedGroupId = `ugmu:medicine:2:stream-${stream}:${expectedGroup}`;
    if (
      context.university !== "ugmu" ||
      context.program !== "medicine" ||
      context.course !== 2 ||
      context.stream !== stream ||
      context.groupCode !== expectedGroup ||
      context.groupId !== expectedGroupId ||
      context.academicYear !== "2026/2027" ||
      context.semester !== 1 ||
      context.timezone !== "Asia/Yekaterinburg"
    ) {
      throw new Error(`${expectedGroup}: preactivation publication context changed`);
    }

    const storageKey = scheduleStorageKey(prepared.batch);
    const expectedStorageKey = `schedules/ugmu/medicine/2/2026-2027/semester-1/${encodeURIComponent(expectedGroupId)}.json`;
    if (storageKey !== expectedStorageKey) throw new Error(`${expectedGroup}: storage target changed`);
    if (storageKeys.has(storageKey)) throw new Error(`${expectedGroup}: duplicate storage target`);
    storageKeys.add(storageKey);
    storagePlan.push(`${expectedGroup}:${storageKey}`);

    if (prepared.batch.schedule.schedule_version_id !== reviewed.schedule.schedule_version_id) {
      throw new Error(`${expectedGroup}: schedule_version_id differs from reviewed canonical baseline`);
    }
    if (prepared.batch.schedule.content_fingerprint !== reviewed.schedule.content_fingerprint) {
      throw new Error(`${expectedGroup}: content_fingerprint differs from reviewed canonical baseline`);
    }
    if (prepared.batch.schedule.version_created_at !== reviewed.schedule.version_created_at) {
      throw new Error(`${expectedGroup}: version_created_at differs from reviewed canonical baseline`);
    }
    versionStableGroups += 1;
    contentFingerprintStableGroups += 1;
    versionTimestampStableGroups += 1;

    const reviewedById = new Map(reviewed.events.map((event) => [event.system.event_id, event]));
    if (reviewedById.size !== reviewed.events.length) throw new Error(`${expectedGroup}: duplicate reviewed event_id`);
    for (const event of prepared.batch.events) {
      const before = reviewedById.get(event.system.event_id);
      if (!before) throw new Error(`${expectedGroup}: publication event_id drifted`);
      if (event.system.fingerprint !== before.system.fingerprint) throw new Error(`${expectedGroup}: event fingerprint drifted`);
      if (event.system.revision !== before.system.revision || event.system.revision !== 1) throw new Error(`${expectedGroup}: event revision drifted`);
      if (JSON.stringify(coreEvent(event)) !== JSON.stringify(coreEvent(before))) throw new Error(`${expectedGroup}: event core semantics drifted`);
      if (!event.calendar?.title) throw new Error(`${expectedGroup}: publication calendar title missing`);
      if (event.calendar.location !== before.calendar.location) throw new Error(`${expectedGroup}: publication calendar location drifted`);
      if (globalEventIds.has(event.system.event_id)) throw new Error(`Global duplicate event_id: ${event.system.event_id}`);
      globalEventIds.add(event.system.event_id);
      eventIdStableCount += 1;
      eventFingerprintStableCount += 1;
      eventRevisionStableCount += 1;
      coreEventStableCount += 1;
    }

    const ics = prepared.ics;
    if (!ics.startsWith("BEGIN:VCALENDAR\r\n") || !ics.endsWith("END:VCALENDAR\r\n")) {
      throw new Error(`${expectedGroup}: malformed VCALENDAR envelope`);
    }
    requirePhysicalLineLengths(ics, expectedGroup);
    if (countIcsComponents(ics, "VCALENDAR") !== 1) throw new Error(`${expectedGroup}: expected one VCALENDAR`);
    if (countIcsComponents(ics, "VEVENT") !== prepared.batch.events.length) throw new Error(`${expectedGroup}: VEVENT count mismatch`);

    const versionValues = icsPropertyValues(ics, "X-SCHEDULE-VERSION");
    const fingerprintValues = icsPropertyValues(ics, "X-SCHEDULE-CONTENT-FINGERPRINT");
    if (versionValues.length !== 1 || versionValues[0] !== prepared.batch.schedule.schedule_version_id) {
      throw new Error(`${expectedGroup}: ICS schedule version mismatch`);
    }
    if (fingerprintValues.length !== 1 || fingerprintValues[0] !== prepared.batch.schedule.content_fingerprint) {
      throw new Error(`${expectedGroup}: ICS content fingerprint mismatch`);
    }

    const uids = icsPropertyValues(ics, "UID");
    const sequences = icsPropertyValues(ics, "SEQUENCE");
    if (uids.length !== prepared.batch.events.length || sequences.length !== prepared.batch.events.length) {
      throw new Error(`${expectedGroup}: ICS UID/SEQUENCE count mismatch`);
    }
    const expectedUids = new Set(prepared.batch.events.map((event) => `${event.system.event_id}@ugmu-calendar`));
    for (const uid of uids) {
      if (!expectedUids.has(uid)) throw new Error(`${expectedGroup}: unexpected ICS UID ${uid}`);
      if (globalUids.has(uid)) throw new Error(`Global duplicate ICS UID: ${uid}`);
      globalUids.add(uid);
      uidValidatedCount += 1;
    }
    for (const sequence of sequences) {
      if (sequence !== "0") throw new Error(`${expectedGroup}: initial publication emitted SEQUENCE:${sequence}`);
      sequenceValidatedCount += 1;
    }

    const unfolded = unfoldIcs(ics);
    const dtLines = unfolded.split("\r\n").filter((line) => line.startsWith("DTSTART:") || line.startsWith("DTEND:"));
    if (dtLines.length !== prepared.batch.events.length * 2) throw new Error(`${expectedGroup}: DTSTART/DTEND count mismatch`);
    if (dtLines.some((line) => /TZID=|Z$/u.test(line))) throw new Error(`${expectedGroup}: floating source times were timezone-converted in ICS`);

    const icsHash = sha256(ics);
    const icsBytes = Buffer.byteLength(ics, "utf8");
    icsHashes.push(`${expectedGroup}:${icsHash}`);
    icsBytesTotal += icsBytes;
    const fileBase = expectedGroup.replaceAll(" ", "-");
    writeFileSync(resolve(icsDir, `${fileBase}.ics`), ics, "utf8");
    writeFileSync(resolve(batchDir, `${fileBase}.json`), `${JSON.stringify(prepared.batch, null, 2)}\n`, "utf8");

    eventCount += prepared.batch.events.length;
    report.groups[expectedGroup] = {
      stream,
      eventCount: prepared.batch.events.length,
      groupId: context.groupId,
      storageKey,
      scheduleVersionId: prepared.batch.schedule.schedule_version_id,
      contentFingerprint: prepared.batch.schedule.content_fingerprint,
      inputQaPublishable: prepared.inputQa.publishable,
      outputQaPublishable: prepared.outputQa.publishable,
      revisionMin: Math.min(...prepared.batch.events.map((event) => event.system.revision)),
      revisionMax: Math.max(...prepared.batch.events.map((event) => event.system.revision)),
      sequenceMin: 0,
      sequenceMax: 0,
      icsBytes,
      icsSha256: icsHash,
    };
  }

  report.summary = {
    groupCount: files.length,
    eventCount,
    inputQaPassedGroups,
    outputQaPassedGroups,
    publicationContextValidatedGroups: files.length,
    storageTargetCount: storageKeys.size,
    versionStableGroups,
    contentFingerprintStableGroups,
    versionTimestampStableGroups,
    eventIdStableCount,
    eventFingerprintStableCount,
    eventRevisionStableCount,
    coreEventStableCount,
    uniqueEventIdCount: globalEventIds.size,
    uniqueUidCount: globalUids.size,
    uidValidatedCount,
    sequenceValidatedCount,
    icsFileCount: files.length,
    icsBytesTotal,
    aggregateIcsSha256: sha256(icsHashes.join("\n")),
    aggregateStoragePlanSha256: sha256(storagePlan.join("\n")),
    revisionMin: 1,
    revisionMax: 1,
    sequenceMin: 0,
    sequenceMax: 0,
    floatingTimePreserved: true,
    icsArtifactsWritten: true,
    icsArtifactScope: "ci-review-only",
    preparedBatchArtifactsWritten: true,
    productionStoreCalls: 0,
    storageWritesPerformed: false,
    catalogWritesPerformed: false,
    accessPolicyWritesPerformed: false,
    salesChangesPerformed: false,
    publicIcsPublicationPerformed: false,
    publicationAllowed: false,
    preactivationReady: true,
    reviewRequired: false,
  };

  const eventFields = [
    "eventCount",
    "eventIdStableCount",
    "eventFingerprintStableCount",
    "eventRevisionStableCount",
    "coreEventStableCount",
    "uniqueEventIdCount",
    "uniqueUidCount",
    "uidValidatedCount",
    "sequenceValidatedCount",
  ];
  if (report.summary.groupCount !== EXPECTED_GROUP_COUNT) throw new Error("Preactivation group count changed");
  for (const field of eventFields) {
    if (report.summary[field] !== EXPECTED_EVENT_COUNT) throw new Error(`${field} expected ${EXPECTED_EVENT_COUNT}, got ${report.summary[field]}`);
  }
  for (const field of [
    "inputQaPassedGroups",
    "outputQaPassedGroups",
    "publicationContextValidatedGroups",
    "storageTargetCount",
    "versionStableGroups",
    "contentFingerprintStableGroups",
    "versionTimestampStableGroups",
    "icsFileCount",
  ]) {
    if (report.summary[field] !== EXPECTED_GROUP_COUNT) throw new Error(`${field} expected ${EXPECTED_GROUP_COUNT}, got ${report.summary[field]}`);
  }
  if (report.summary.revisionMin !== 1 || report.summary.revisionMax !== 1 || report.summary.sequenceMin !== 0 || report.summary.sequenceMax !== 0) {
    throw new Error("Preactivation revision/sequence baseline changed");
  }
  if (report.summary.productionStoreCalls !== 0 || report.summary.storageWritesPerformed !== false || report.summary.publicIcsPublicationPerformed !== false) {
    throw new Error("Dry-run isolation boundary was violated");
  }

  writeFileSync(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.summary));
}

main();
