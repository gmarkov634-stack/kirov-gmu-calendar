#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildScheduleIcs } from "../src/schedule/ics.js";
import { versionSchedule } from "../src/schedule/versioning.js";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_GROUP_COUNT = 48;
const EXPECTED_EVENT_COUNT = 11056;
const REIMPORT_NOW = "2026-08-23T01:00:00.000Z";

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (match) values.set(match[1], match[2]);
  }
  if (!values.get("canonical-dir")) throw new Error("Missing --canonical-dir=...");
  if (!values.get("output")) throw new Error("Missing --output=...");
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function cleanReimportBatch(previous) {
  const incoming = structuredClone(previous);
  delete incoming.schedule.schedule_version_id;
  delete incoming.schedule.previous_schedule_version_id;
  delete incoming.schedule.content_fingerprint;
  delete incoming.schedule.version_created_at;
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

function expectedUid(event) {
  return `${event.system.event_id}@ugmu-calendar`;
}

function requireCanonicalBatch(batch, expectedGroup) {
  if (batch?.schema_version !== "1.0" || !batch?.schedule || !Array.isArray(batch?.events)) {
    throw new Error(`${expectedGroup}: invalid canonical batch`);
  }
  if (batch.schedule.university_code !== "ugmu" || batch.schedule.course !== 2 || batch.schedule.group !== expectedGroup) {
    throw new Error(`${expectedGroup}: canonical scope mismatch`);
  }
  if (!batch.schedule.schedule_version_id || !batch.schedule.content_fingerprint || !batch.schedule.version_created_at) {
    throw new Error(`${expectedGroup}: initial version metadata missing`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const canonicalDir = resolve(args.get("canonical-dir"));
  const output = resolve(args.get("output"));
  mkdirSync(resolve(output, ".."), { recursive: true });

  const files = readdirSync(canonicalDir)
    .filter((name) => /^ОЛД-\d+\.json$/u.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (files.length !== EXPECTED_GROUP_COUNT) throw new Error(`Expected ${EXPECTED_GROUP_COUNT} canonical group files, got ${files.length}`);

  const report = {
    version: 1,
    stage: "deterministic-reimport-identity-review",
    university: "ugmu",
    program: "medicine",
    course: 2,
    groups: {},
    summary: {},
  };

  const globalEventIds = new Set();
  const globalUids = new Set();
  const globalVersionIds = new Set();
  const groupIcsHashes = [];
  let eventCount = 0;
  let unchangedEventCount = 0;
  let exactFingerprintMatchCount = 0;
  let eventIdStableCount = 0;
  let fingerprintStableCount = 0;
  let revisionStableCount = 0;
  let timestampsStableCount = 0;
  let uidStableCount = 0;
  let sequenceStableCount = 0;
  let scheduleVersionStableGroups = 0;
  let contentFingerprintStableGroups = 0;
  let versionTimestampStableGroups = 0;
  let byteIdenticalIcsGroups = 0;

  for (let index = 0; index < files.length; index += 1) {
    const expectedGroup = EXPECTED_GROUPS[index];
    const file = files[index];
    const previous = loadJson(resolve(canonicalDir, file));
    requireCanonicalBatch(previous, expectedGroup);

    const incoming = cleanReimportBatch(previous);
    const { batch: repeated, diff } = versionSchedule(previous, incoming, {
      now: REIMPORT_NOW,
      eventIdFactory: () => {
        throw new Error(`${expectedGroup}: unchanged re-import unexpectedly requested a new event_id`);
      },
      versionIdFactory: () => {
        throw new Error(`${expectedGroup}: unchanged re-import unexpectedly requested a new schedule_version_id`);
      },
    });

    if (diff.same_content !== true) throw new Error(`${expectedGroup}: repeated import was not recognized as same content`);
    if (diff.counts.added !== 0 || diff.counts.changed !== 0 || diff.counts.removed !== 0 || diff.counts.unchanged !== previous.events.length) {
      throw new Error(`${expectedGroup}: repeated import diff is not fully unchanged`);
    }
    if (diff.unchanged.some((item) => item.matched_by !== "exact_fingerprint")) {
      throw new Error(`${expectedGroup}: repeated import used a non-fingerprint fallback match`);
    }

    if (repeated.schedule.schedule_version_id !== previous.schedule.schedule_version_id) {
      throw new Error(`${expectedGroup}: schedule_version_id drifted`);
    }
    if (repeated.schedule.content_fingerprint !== previous.schedule.content_fingerprint) {
      throw new Error(`${expectedGroup}: content_fingerprint drifted`);
    }
    if (repeated.schedule.version_created_at !== previous.schedule.version_created_at) {
      throw new Error(`${expectedGroup}: version_created_at drifted`);
    }
    scheduleVersionStableGroups += 1;
    contentFingerprintStableGroups += 1;
    versionTimestampStableGroups += 1;
    globalVersionIds.add(repeated.schedule.schedule_version_id);

    const previousById = new Map(previous.events.map((event) => [event.system.event_id, event]));
    if (previousById.size !== previous.events.length) throw new Error(`${expectedGroup}: duplicate initial event_id`);
    for (const event of repeated.events) {
      const before = previousById.get(event.system.event_id);
      if (!before) throw new Error(`${expectedGroup}: event_id was not preserved`);
      if (event.system.event_id !== before.system.event_id) throw new Error(`${expectedGroup}: event_id drifted`);
      if (event.system.fingerprint !== before.system.fingerprint) throw new Error(`${expectedGroup}: fingerprint drifted for ${event.system.event_id}`);
      if (event.system.revision !== before.system.revision) throw new Error(`${expectedGroup}: revision drifted for ${event.system.event_id}`);
      if (event.system.created_at !== before.system.created_at || event.system.updated_at !== before.system.updated_at) {
        throw new Error(`${expectedGroup}: event timestamps drifted for ${event.system.event_id}`);
      }
      if (event.system.revision !== 1) throw new Error(`${expectedGroup}: unchanged initial event revision is not 1`);
      if (globalEventIds.has(event.system.event_id)) throw new Error(`Global duplicate event_id: ${event.system.event_id}`);
      globalEventIds.add(event.system.event_id);
      eventIdStableCount += 1;
      fingerprintStableCount += 1;
      revisionStableCount += 1;
      timestampsStableCount += 1;
    }

    const firstIcs = buildScheduleIcs(previous);
    const repeatedIcs = buildScheduleIcs(repeated);
    const firstHash = sha256(firstIcs);
    const repeatedHash = sha256(repeatedIcs);
    if (firstHash !== repeatedHash || firstIcs !== repeatedIcs) throw new Error(`${expectedGroup}: ICS serialization drifted after unchanged re-import`);
    byteIdenticalIcsGroups += 1;
    groupIcsHashes.push(`${expectedGroup}:${repeatedHash}`);

    const firstUids = icsPropertyValues(firstIcs, "UID");
    const repeatedUids = icsPropertyValues(repeatedIcs, "UID");
    const firstSequences = icsPropertyValues(firstIcs, "SEQUENCE");
    const repeatedSequences = icsPropertyValues(repeatedIcs, "SEQUENCE");
    if (repeatedUids.length !== repeated.events.length || repeatedSequences.length !== repeated.events.length) {
      throw new Error(`${expectedGroup}: ICS UID/SEQUENCE count mismatch`);
    }
    if (JSON.stringify(firstUids) !== JSON.stringify(repeatedUids)) throw new Error(`${expectedGroup}: UID list drifted`);
    if (JSON.stringify(firstSequences) !== JSON.stringify(repeatedSequences)) throw new Error(`${expectedGroup}: SEQUENCE list drifted`);

    const expectedUids = new Set(repeated.events.map(expectedUid));
    if (expectedUids.size !== repeated.events.length) throw new Error(`${expectedGroup}: expected UID collision`);
    for (const uid of repeatedUids) {
      if (!expectedUids.has(uid)) throw new Error(`${expectedGroup}: unexpected UID ${uid}`);
      if (globalUids.has(uid)) throw new Error(`Global duplicate UID: ${uid}`);
      globalUids.add(uid);
      uidStableCount += 1;
    }
    for (const sequence of repeatedSequences) {
      if (sequence !== "0") throw new Error(`${expectedGroup}: unchanged initial event emitted SEQUENCE:${sequence}`);
      sequenceStableCount += 1;
    }

    eventCount += repeated.events.length;
    unchangedEventCount += diff.counts.unchanged;
    exactFingerprintMatchCount += diff.unchanged.length;
    report.groups[expectedGroup] = {
      eventCount: repeated.events.length,
      unchangedEventCount: diff.counts.unchanged,
      exactFingerprintMatchCount: diff.unchanged.length,
      scheduleVersionId: repeated.schedule.schedule_version_id,
      contentFingerprint: repeated.schedule.content_fingerprint,
      revisionMin: Math.min(...repeated.events.map((event) => event.system.revision)),
      revisionMax: Math.max(...repeated.events.map((event) => event.system.revision)),
      sequenceMin: 0,
      sequenceMax: 0,
      icsSha256: repeatedHash,
    };
  }

  report.summary = {
    groupCount: files.length,
    eventCount,
    unchangedEventCount,
    exactFingerprintMatchCount,
    eventIdStableCount,
    fingerprintStableCount,
    revisionStableCount,
    timestampsStableCount,
    uidStableCount,
    sequenceStableCount,
    uniqueEventIdCount: globalEventIds.size,
    uniqueUidCount: globalUids.size,
    uniqueScheduleVersionIdCount: globalVersionIds.size,
    scheduleVersionStableGroups,
    contentFingerprintStableGroups,
    versionTimestampStableGroups,
    byteIdenticalIcsGroups,
    aggregateIcsIdentitySha256: sha256(groupIcsHashes.join("\n")),
    repeatedImportSameContentGroups: files.length,
    revisionMin: 1,
    revisionMax: 1,
    sequenceMin: 0,
    sequenceMax: 0,
    icsSerializationChecked: true,
    icsArtifactsWritten: false,
    storageWritesPerformed: false,
    publicationAllowed: false,
    reviewRequired: false,
  };

  const expectedEventFields = [
    "eventCount",
    "unchangedEventCount",
    "exactFingerprintMatchCount",
    "eventIdStableCount",
    "fingerprintStableCount",
    "revisionStableCount",
    "timestampsStableCount",
    "uidStableCount",
    "sequenceStableCount",
    "uniqueEventIdCount",
    "uniqueUidCount",
  ];
  if (report.summary.groupCount !== EXPECTED_GROUP_COUNT) throw new Error("Identity group count changed");
  for (const field of expectedEventFields) {
    if (report.summary[field] !== EXPECTED_EVENT_COUNT) throw new Error(`${field} expected ${EXPECTED_EVENT_COUNT}, got ${report.summary[field]}`);
  }
  for (const field of ["scheduleVersionStableGroups", "contentFingerprintStableGroups", "versionTimestampStableGroups", "byteIdenticalIcsGroups", "repeatedImportSameContentGroups"]) {
    if (report.summary[field] !== EXPECTED_GROUP_COUNT) throw new Error(`${field} expected ${EXPECTED_GROUP_COUNT}, got ${report.summary[field]}`);
  }
  if (report.summary.uniqueScheduleVersionIdCount !== EXPECTED_GROUP_COUNT) throw new Error("Schedule version IDs are not unique across all groups");
  if (report.summary.revisionMin !== 1 || report.summary.revisionMax !== 1 || report.summary.sequenceMin !== 0 || report.summary.sequenceMax !== 0) {
    throw new Error("Initial revision/sequence identity baseline changed");
  }

  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.summary));
}

main();
