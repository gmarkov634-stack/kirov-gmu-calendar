import fs from "node:fs/promises";
import path from "node:path";

import { buildScheduleIcs } from "../src/schedule/ics.js";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule } from "../src/schedule/validate.js";
import { versionSchedule } from "../src/schedule/versioning.js";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_TOTAL_EVENTS = 10704;

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}
function slug(group) { return String(group).replace(/[^0-9]+/g, ""); }
function eventIdFactory(group) {
  const groupSlug = slug(group);
  return (_event, index) => `evt_ugmu_old${groupSlug}_${String(index + 1).padStart(4, "0")}`;
}
function versionId(group, suffix) { return `ver_ugmu_old${slug(group)}_${suffix}`; }
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
  for (const event of events) counts.set(occurrenceKey(event), (counts.get(occurrenceKey(event)) || 0) + 1);
  const index = events.findIndex((event) => counts.get(occurrenceKey(event)) === 1);
  if (index < 0) throw new Error("No unique UGMU course-2 event available for versioning regression");
  return index;
}
function prepareVersion(batch, previousBatch, now, id) {
  return versionSchedule(previousBatch, batch, { now, eventIdFactory: eventIdFactory(batch.schedule.group), versionIdFactory: () => id });
}
function postprocessed(versioned) {
  const batch = postprocessSchedule(versioned, { includeServiceSignature: false, longBreakDays: 14 });
  const qa = validatePostprocessedSchedule(batch);
  if (!qa.publishable) throw new Error(`Postprocessed UGMU course-2 version failed QA: ${JSON.stringify(qa.errors)}`);
  return { batch, qa, ics: buildScheduleIcs(batch) };
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
function assert(condition, message, errors) { if (!condition) errors.push(message); }

const packageDir = path.resolve(arg("package-dir", "data/imports/ugmu-course2/canonical-package"));
const outputPath = path.resolve(arg("output", "data/imports/ugmu-course2/versioning/course2-versioning-regression.json"));
const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "manifest.json"), "utf8"));
if (!manifest.passed || manifest.publicationAllowed !== false || manifest.groups !== 48 || manifest.events !== EXPECTED_TOTAL_EVENTS) {
  throw new Error("UGMU course-2 canonical package is not approved fail-closed evidence");
}

const groupReports = [];
for (const group of EXPECTED_GROUPS) {
  const canonicalPath = path.join(packageDir, "canonical", `${group.replace(" ", "-")}.json`);
  const canonical = JSON.parse(await fs.readFile(canonicalPath, "utf8"));
  const errors = [];
  assert(canonical.schedule?.group === group, "canonical group mismatch", errors);
  assert(canonical.schedule?.university_code === "ugmu", "canonical university mismatch", errors);
  assert(canonical.schedule?.course === 2, "canonical course mismatch", errors);
  assert(canonical.events?.length > 0, "canonical event set is empty", errors);

  const v1 = prepareVersion(structuredClone(canonical), null, "2026-08-22T15:30:00.000Z", versionId(group, "v1"));
  const p1 = postprocessed(v1.batch);
  const exact = prepareVersion(structuredClone(canonical), v1.batch, "2026-08-22T15:35:00.000Z", versionId(group, "unused"));
  const pExact = postprocessed(exact.batch);

  const changedCanonical = structuredClone(canonical);
  const changedIndex = findUniqueMutableEvent(changedCanonical.events);
  const changedIncoming = changedCanonical.events[changedIndex];
  changedIncoming.lesson.source_note = `${changedIncoming.lesson.source_note ? `${changedIncoming.lesson.source_note}; ` : ""}QA-COURSE2-VERSIONING-CHANGE`;
  changedIncoming.source.references = [
    ...(changedIncoming.source.references || []),
    { role: "note", range: "synthetic-course2-versioning:source-note-change" },
  ];
  const v2 = prepareVersion(changedCanonical, v1.batch, "2026-08-22T15:40:00.000Z", versionId(group, "v2"));
  const p2 = postprocessed(v2.batch);
  const targetV1 = p1.batch.events.find((event) => event.system.event_id === v1.batch.events[changedIndex].system.event_id);
  const targetV2 = p2.batch.events.find((event) => event.system.event_id === targetV1?.system.event_id);
  const uid = targetV1?.system.event_id ? `${targetV1.system.event_id}@ugmu-calendar` : null;
  const v1Block = uid ? eventBlockByUid(p1.ics, uid) : null;
  const exactBlock = uid ? eventBlockByUid(pExact.ics, uid) : null;
  const v2Block = uid ? eventBlockByUid(p2.ics, uid) : null;

  assert(v1.diff.counts.added === canonical.events.length, `initial added mismatch: ${v1.diff.counts.added}`, errors);
  assert(v1.diff.counts.changed === 0 && v1.diff.counts.removed === 0, "initial version reports changed/removed", errors);
  assert(exact.diff.same_content === true, "exact re-import must be same_content", errors);
  assert(exact.batch.schedule.schedule_version_id === v1.batch.schedule.schedule_version_id, "exact re-import changed schedule version", errors);
  assert(exact.diff.counts.unchanged === canonical.events.length, `exact unchanged mismatch: ${exact.diff.counts.unchanged}`, errors);
  assert(exact.diff.counts.added === 0 && exact.diff.counts.changed === 0 && exact.diff.counts.removed === 0, "exact re-import has nonzero diff", errors);
  assert(v2.diff.same_content === false, "synthetic correction did not change content fingerprint", errors);
  assert(v2.batch.schedule.previous_schedule_version_id === v1.batch.schedule.schedule_version_id, "v2 previous version mismatch", errors);
  assert(v2.diff.counts.changed === 1, `synthetic correction changed ${v2.diff.counts.changed} events`, errors);
  assert(v2.diff.counts.unchanged === canonical.events.length - 1, `synthetic unchanged mismatch: ${v2.diff.counts.unchanged}`, errors);
  assert(v2.diff.counts.added === 0 && v2.diff.counts.removed === 0, "synthetic correction became add/remove", errors);
  assert(Boolean(targetV1 && targetV2), "synthetic target event_id not preserved", errors);
  assert(targetV2?.system.revision === 2 && targetV1?.system.revision === 1, "revision must advance 1 -> 2", errors);
  assert(Boolean(v1Block && exactBlock && v2Block), "target VEVENT missing from one of the feeds", errors);
  assert(lineValue(v1Block, "UID") === uid && lineValue(exactBlock, "UID") === uid && lineValue(v2Block, "UID") === uid, "UID instability detected", errors);
  assert(lineValue(v1Block, "SEQUENCE") === "0", "v1 SEQUENCE must be 0", errors);
  assert(lineValue(exactBlock, "SEQUENCE") === "0", "exact re-import SEQUENCE must remain 0", errors);
  assert(lineValue(v2Block, "SEQUENCE") === "1", "changed event SEQUENCE must become 1", errors);
  assert(lineValue(v1Block, "CREATED") === lineValue(v2Block, "CREATED"), "CREATED must remain stable", errors);
  assert(lineValue(v1Block, "LAST-MODIFIED") !== lineValue(v2Block, "LAST-MODIFIED"), "LAST-MODIFIED must advance", errors);
  assert(p1.qa.publishable && pExact.qa.publishable && p2.qa.publishable, "postprocessed QA failed", errors);

  groupReports.push({
    group,
    stream: canonical.events[0]?.audience?.stream || null,
    passed: errors.length === 0,
    events: canonical.events.length,
    exactReimport: { unchanged: exact.diff.counts.unchanged, scheduleVersionStable: exact.batch.schedule.schedule_version_id === v1.batch.schedule.schedule_version_id },
    simulatedChange: {
      targetUid: uid,
      eventIdStable: targetV2?.system.event_id === targetV1?.system.event_id,
      revisionV1: targetV1?.system.revision ?? null,
      revisionV2: targetV2?.system.revision ?? null,
      sequenceV1: lineValue(v1Block, "SEQUENCE"),
      sequenceV2: lineValue(v2Block, "SEQUENCE"),
      changed: v2.diff.counts.changed,
      unchanged: v2.diff.counts.unchanged,
      added: v2.diff.counts.added,
      removed: v2.diff.counts.removed,
    },
    errors,
  });
}

const totals = {
  groups: groupReports.length,
  events: groupReports.reduce((sum, item) => sum + item.events, 0),
  exactUnchanged: groupReports.reduce((sum, item) => sum + item.exactReimport.unchanged, 0),
  simulatedChanged: groupReports.reduce((sum, item) => sum + item.simulatedChange.changed, 0),
  simulatedUnchanged: groupReports.reduce((sum, item) => sum + item.simulatedChange.unchanged, 0),
  stableUidGroups: groupReports.filter((item) => item.simulatedChange.eventIdStable).length,
  sequenceAdvancedGroups: groupReports.filter((item) => item.simulatedChange.sequenceV1 === "0" && item.simulatedChange.sequenceV2 === "1").length,
};
const passed = groupReports.every((item) => item.passed)
  && totals.groups === 48
  && totals.events === EXPECTED_TOTAL_EVENTS
  && totals.exactUnchanged === EXPECTED_TOTAL_EVENTS
  && totals.simulatedChanged === 48
  && totals.simulatedUnchanged === EXPECTED_TOTAL_EVENTS - 48
  && totals.stableUidGroups === 48
  && totals.sequenceAdvancedGroups === 48;
const report = {
  version: 1, university: "ugmu", program: "medicine", course: 2, academicYear: "2026/2027", semester: 1,
  groups: groupReports, totals, passed, publicationAllowed: false,
  nextGate: passed ? "course2-preactivation-dry-run" : "fix-course2-versioning",
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU course-2 versioning regression: ${passed ? "PASS" : "FAIL"}`);
console.log(`Stable UID groups: ${totals.stableUidGroups}/48; SEQUENCE advanced: ${totals.sequenceAdvancedGroups}/48`);
console.log(`Exact unchanged events: ${totals.exactUnchanged}/${EXPECTED_TOTAL_EVENTS}`);
console.log("Publication allowed: no");
if (!passed) process.exitCode = 2;
