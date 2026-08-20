import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuWeeklyPilot } from "../src/adapters/ugmu/canonical.mjs";
import { buildScheduleIcs } from "../src/schedule/ics.js";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule } from "../src/schedule/validate.js";
import { versionSchedule } from "../src/schedule/versioning.js";

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function clone(value) {
  return structuredClone(value);
}

function occurrenceKey(event) {
  return JSON.stringify({
    date: event.timing?.date ?? null,
    discipline: String(event.lesson?.discipline?.normalized || "").trim().toLocaleLowerCase("ru-RU"),
    type: event.lesson?.type?.code ?? null,
    group: event.audience?.group ?? null,
    scope: event.audience?.scope ?? null,
    subgroups: [...(event.audience?.subgroups || [])].sort(),
    stream: event.audience?.stream ?? null,
  });
}

function findUniqueMutableEvent(events) {
  const counts = new Map();
  for (const event of events) {
    const key = occurrenceKey(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const index = events.findIndex((event) =>
    counts.get(occurrenceKey(event)) === 1 && Array.isArray(event.lesson?.locations) && event.lesson.locations.length > 0
  );
  if (index < 0) throw new Error("No unique UGMU event with a location is available for versioning regression");
  return index;
}

function version(batch, previousBatch, now, versionId) {
  return versionSchedule(previousBatch, batch, {
    now,
    eventIdFactory: (_event, index) => `evt_ugmu_old101_${String(index + 1).padStart(4, "0")}`,
    versionIdFactory: () => versionId,
  });
}

function processed(versioned) {
  const result = postprocessSchedule(versioned, {
    includeServiceSignature: false,
    longBreakDays: 14,
  });
  const qa = validatePostprocessedSchedule(result);
  if (!qa.publishable) throw new Error(`Postprocessed version is not publishable: ${JSON.stringify(qa.errors)}`);
  return { batch: result, qa, ics: buildScheduleIcs(result) };
}

function eventBlockByUid(ics, uid) {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT\r\n").slice(1).map((value) => value.split("END:VEVENT")[0]);
  return blocks.find((block) => block.includes(`UID:${uid}\r\n`)) || null;
}

function lineValue(block, name) {
  const match = String(block || "").match(new RegExp(`(?:^|\\r\\n)${name}:([^\\r\\n]+)`));
  return match ? match[1] : null;
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const inputPath = readArg("input");
const outputDir = readArg("output", "data/imports/ugmu-pilot/versioning");
if (!inputPath) throw new Error("--input is required");

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const canonical = canonicalizeUgmuWeeklyPilot(raw);

const first = version(canonical, null, "2026-08-20T17:10:00.000Z", "ver_ugmu_old101_v1");
const firstProcessed = processed(first.batch);

// Re-import the exact same semantic content. This must be idempotent: the
// schedule version, event IDs, revisions and ICS SEQUENCE values stay stable.
const exactReimport = version(canonicalizeUgmuWeeklyPilot(raw), first.batch, "2026-08-20T17:20:00.000Z", "ver_should_not_be_used");
const exactProcessed = processed(exactReimport.batch);

// Synthetic official-source change: alter the location of exactly one unique
// occurrence while keeping date/discipline/type/audience intact. This models a
// real room/address correction without creating a second calendar event.
const changedIncoming = canonicalizeUgmuWeeklyPilot(raw);
const changedIndex = findUniqueMutableEvent(changedIncoming.events);
const changedEvent = changedIncoming.events[changedIndex];
const originalLocation = clone(changedEvent.lesson.locations[0]);
changedEvent.lesson.locations[0] = {
  ...changedEvent.lesson.locations[0],
  room: "QA-CHANGE",
};
changedEvent.source.references = [
  ...changedEvent.source.references,
  { role: "location", range: "synthetic-versioning-regression:QA-CHANGE" },
];
changedEvent.source.raw_text = `${changedEvent.source.raw_text} [synthetic location change]`;

const second = version(changedIncoming, first.batch, "2026-08-20T17:30:00.000Z", "ver_ugmu_old101_v2");
const secondProcessed = processed(second.batch);

const targetV1 = firstProcessed.batch.events[changedIndex];
const targetV2 = secondProcessed.batch.events.find((event) => event.system.event_id === targetV1.system.event_id);
const uid = `${targetV1.system.event_id}@ugmu-calendar`;
const v1Block = eventBlockByUid(firstProcessed.ics, uid);
const sameBlock = eventBlockByUid(exactProcessed.ics, uid);
const v2Block = eventBlockByUid(secondProcessed.ics, uid);

const errors = [];
assert(first.diff.counts.added === 357, `initial version must add 357 events, got ${first.diff.counts.added}`, errors);
assert(first.diff.counts.changed === 0 && first.diff.counts.removed === 0, "initial version must not report changed/removed events", errors);
assert(first.batch.schedule.schedule_version_id === "ver_ugmu_old101_v1", "initial version id mismatch", errors);

assert(exactReimport.diff.same_content === true, "exact re-import must be same_content", errors);
assert(exactReimport.batch.schedule.schedule_version_id === first.batch.schedule.schedule_version_id, "exact re-import must retain schedule_version_id", errors);
assert(exactReimport.diff.counts.unchanged === 357, `exact re-import must keep 357 unchanged events, got ${exactReimport.diff.counts.unchanged}`, errors);
assert(exactReimport.diff.counts.added === 0 && exactReimport.diff.counts.changed === 0 && exactReimport.diff.counts.removed === 0, "exact re-import must have zero added/changed/removed", errors);

assert(second.diff.same_content === false, "changed import must produce new content fingerprint", errors);
assert(second.batch.schedule.schedule_version_id === "ver_ugmu_old101_v2", "changed import must receive v2 schedule_version_id", errors);
assert(second.batch.schedule.previous_schedule_version_id === "ver_ugmu_old101_v1", "v2 must point to v1 as previous version", errors);
assert(second.diff.counts.changed === 1, `changed import must change exactly 1 event, got ${second.diff.counts.changed}`, errors);
assert(second.diff.counts.unchanged === 356, `changed import must keep 356 unchanged events, got ${second.diff.counts.unchanged}`, errors);
assert(second.diff.counts.added === 0 && second.diff.counts.removed === 0, "location correction must not add/remove events", errors);
assert(Boolean(targetV2), "changed event must retain its event_id", errors);
assert(targetV2?.system.event_id === targetV1.system.event_id, "event_id must stay stable across location correction", errors);
assert(targetV1.system.revision === 1, `v1 revision must be 1, got ${targetV1.system.revision}`, errors);
assert(targetV2?.system.revision === 2, `v2 revision must be 2, got ${targetV2?.system.revision}`, errors);
assert(targetV2?.lesson.locations[0]?.room === "QA-CHANGE", "v2 must contain simulated location correction", errors);

assert(Boolean(v1Block && sameBlock && v2Block), "target VEVENT must exist in all three ICS feeds", errors);
assert(lineValue(v1Block, "UID") === uid, "v1 UID mismatch", errors);
assert(lineValue(sameBlock, "UID") === uid, "exact re-import UID must remain stable", errors);
assert(lineValue(v2Block, "UID") === uid, "v2 UID must remain stable", errors);
assert(lineValue(v1Block, "SEQUENCE") === "0", `v1 SEQUENCE must be 0, got ${lineValue(v1Block, "SEQUENCE")}`, errors);
assert(lineValue(sameBlock, "SEQUENCE") === "0", `exact re-import SEQUENCE must remain 0, got ${lineValue(sameBlock, "SEQUENCE")}`, errors);
assert(lineValue(v2Block, "SEQUENCE") === "1", `changed event SEQUENCE must be 1, got ${lineValue(v2Block, "SEQUENCE")}`, errors);
assert(lineValue(v1Block, "CREATED") === lineValue(v2Block, "CREATED"), "CREATED timestamp must stay stable on update", errors);
assert(lineValue(v1Block, "LAST-MODIFIED") !== lineValue(v2Block, "LAST-MODIFIED"), "LAST-MODIFIED must change on update", errors);

const unchangedIdsV1 = new Set(firstProcessed.batch.events.filter((_, index) => index !== changedIndex).map((event) => event.system.event_id));
const unchangedV2 = secondProcessed.batch.events.filter((event) => unchangedIdsV1.has(event.system.event_id));
assert(unchangedV2.length === 356, `expected 356 preserved unchanged IDs, got ${unchangedV2.length}`, errors);
assert(unchangedV2.every((event) => event.system.revision === 1), "unchanged events must retain revision=1", errors);

const report = {
  version: 1,
  university: "ugmu",
  group: "ОЛД 101",
  sourceSha256: raw.sources?.[0]?.sha256 || null,
  eventCount: canonical.events.length,
  exactReimport: {
    sameContent: exactReimport.diff.same_content,
    scheduleVersionStable: exactReimport.batch.schedule.schedule_version_id === first.batch.schedule.schedule_version_id,
    counts: exactReimport.diff.counts,
    targetUid: lineValue(sameBlock, "UID"),
    targetSequence: lineValue(sameBlock, "SEQUENCE"),
  },
  simulatedChange: {
    kind: "location-room-correction",
    synthetic: true,
    targetIndex: changedIndex,
    targetDate: targetV1.timing.date,
    targetDiscipline: targetV1.lesson.discipline.normalized,
    targetType: targetV1.lesson.type.code,
    originalLocation,
    changedLocation: targetV2?.lesson.locations[0] || null,
    eventIdStable: targetV2?.system.event_id === targetV1.system.event_id,
    uidV1: lineValue(v1Block, "UID"),
    uidV2: lineValue(v2Block, "UID"),
    revisionV1: targetV1.system.revision,
    revisionV2: targetV2?.system.revision ?? null,
    sequenceV1: lineValue(v1Block, "SEQUENCE"),
    sequenceV2: lineValue(v2Block, "SEQUENCE"),
    scheduleVersionV1: first.batch.schedule.schedule_version_id,
    scheduleVersionV2: second.batch.schedule.schedule_version_id,
    previousScheduleVersionV2: second.batch.schedule.previous_schedule_version_id,
    counts: second.diff.counts,
  },
  qa: {
    v1: firstProcessed.qa.publishable,
    exactReimport: exactProcessed.qa.publishable,
    v2: secondProcessed.qa.publishable,
  },
  passed: errors.length === 0,
  publicationAllowed: false,
  nextGate: errors.length === 0 ? "ics-current-json-and-live-catalog" : "fix-versioning-regression",
  errors,
};

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "OLD-101.version-v1.json"), `${JSON.stringify(firstProcessed.batch, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "OLD-101.version-v2.json"), `${JSON.stringify(secondProcessed.batch, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "OLD-101.v1.ics"), firstProcessed.ics),
  fs.writeFile(path.join(outputDir, "OLD-101.v2.ics"), secondProcessed.ics),
  fs.writeFile(path.join(outputDir, "OLD-101.versioning-report.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

console.log(`UGMU OLD 101 versioning regression: ${report.passed ? "PASS" : "FAIL"}`);
console.log(`Exact re-import unchanged: ${exactReimport.diff.counts.unchanged}/357`);
console.log(`Simulated change: changed=${second.diff.counts.changed}, unchanged=${second.diff.counts.unchanged}, added=${second.diff.counts.added}, removed=${second.diff.counts.removed}`);
console.log(`Stable UID: ${report.simulatedChange.eventIdStable ? "yes" : "no"}`);
console.log(`SEQUENCE: ${report.simulatedChange.sequenceV1} -> ${report.simulatedChange.sequenceV2}`);
console.log("Publication allowed: no");
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 2;
}
