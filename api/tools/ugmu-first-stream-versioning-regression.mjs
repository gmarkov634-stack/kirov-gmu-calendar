import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuWeeklyFirstStream } from "../src/adapters/ugmu/canonical.mjs";
import { buildScheduleIcs } from "../src/schedule/ics.js";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule } from "../src/schedule/validate.js";
import { versionSchedule } from "../src/schedule/versioning.js";

const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function slug(group) {
  return String(group).replace(/[^0-9]+/g, "");
}

function eventIdFactory(group) {
  const groupSlug = slug(group);
  return (_event, index) => `evt_ugmu_old${groupSlug}_${String(index + 1).padStart(4, "0")}`;
}

function versionId(group, suffix) {
  return `ver_ugmu_old${slug(group)}_${suffix}`;
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
    counts.get(occurrenceKey(event)) === 1
    && Array.isArray(event.lesson?.locations)
    && event.lesson.locations.length > 0
  );
  if (index < 0) throw new Error("No unique UGMU first-stream event with a location for versioning regression");
  return index;
}

function prepareVersion(batch, previousBatch, now, id) {
  return versionSchedule(previousBatch, batch, {
    now,
    eventIdFactory: eventIdFactory(batch.schedule.group),
    versionIdFactory: () => id,
  });
}

function postprocessed(versioned) {
  const batch = postprocessSchedule(versioned, {
    includeServiceSignature: false,
    longBreakDays: 14,
  });
  const qa = validatePostprocessedSchedule(batch);
  if (!qa.publishable) throw new Error(`Postprocessed first-stream version failed QA: ${JSON.stringify(qa.errors)}`);
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

function canonicalLocation(event) {
  return event.lesson?.locations?.[0]?.raw || null;
}

function controlMatches(event, control) {
  return event.timing?.date === control.date
    && event.timing?.start_time === control.start
    && event.timing?.end_time === control.end
    && event.lesson?.discipline?.normalized === control.title
    && event.lesson?.type?.code === control.type
    && canonicalLocation(event) === control.location;
}

function validateFixture(raw, canonical, fixtureGroup, sourceSha256) {
  const errors = [];
  const lectureCount = canonical.events.filter((event) => event.lesson?.type?.code === "lecture").length;
  const otherCount = canonical.events.filter((event) => event.lesson?.type?.code === "other").length;
  const uniqueDates = new Set(canonical.events.map((event) => event.timing?.date)).size;
  const actualSha = raw.sources?.[0]?.sha256 || null;

  if (actualSha !== sourceSha256) errors.push(`source SHA mismatch: ${actualSha}`);
  if ((raw.patterns?.length ?? 0) !== fixtureGroup.patterns) errors.push(`pattern count mismatch: ${raw.patterns?.length ?? 0}`);
  if (canonical.events.length !== fixtureGroup.events) errors.push(`event count mismatch: ${canonical.events.length}`);
  if (lectureCount !== fixtureGroup.lectures) errors.push(`lecture count mismatch: ${lectureCount}`);
  if (otherCount !== fixtureGroup.other) errors.push(`other count mismatch: ${otherCount}`);
  if (uniqueDates !== fixtureGroup.uniqueDates) errors.push(`unique date count mismatch: ${uniqueDates}`);
  if ((raw.sourceReview?.semanticDecisions?.length ?? 0) !== fixtureGroup.semanticDecisions) errors.push("semantic decision count mismatch");
  if ((raw.sourceReview?.sourceAnomalies?.length ?? 0) !== fixtureGroup.sourceAnomalies) errors.push("source anomaly count mismatch");
  if ((raw.sourceReview?.sourceOverlaps?.length ?? 0) !== fixtureGroup.sourceOverlaps) errors.push("source overlap count mismatch");

  for (const control of fixtureGroup.controls || []) {
    if (!canonical.events.some((event) => controlMatches(event, control))) {
      errors.push(`missing control event: ${control.role} ${control.date} ${control.start} ${control.title}`);
    }
  }

  for (const special of fixtureGroup.specialControls || []) {
    if (special.role === "official-source-overlap") {
      const matched = (raw.sourceReview?.sourceOverlaps || []).some((item) =>
        item.date === special.date
        && item.firstTitle === special.first.title
        && item.firstStart === special.first.start
        && item.firstEnd === special.first.end
        && item.secondTitle === special.second.title
        && item.secondStart === special.second.start
        && item.secondEnd === special.second.end
      );
      if (!matched) errors.push(`missing source-overlap control on ${special.date}`);
    } else if (special.role === "sha-bound-title-resolution") {
      const matched = (raw.sourceReview?.semanticDecisions || []).some((item) =>
        item.sourceSha256 === sourceSha256
        && item.group === fixtureGroup.group
        && item.weekday === special.weekday
        && item.startTime === special.start
        && item.rawTitle === special.rawTitle
        && item.resolvedTitle === special.resolvedTitle
      );
      if (!matched) errors.push(`missing SHA-bound title resolution at ${special.start}`);
    } else {
      errors.push(`unknown special control role: ${special.role}`);
    }
  }

  return {
    passed: errors.length === 0,
    controls: fixtureGroup.controls?.length ?? 0,
    specialControls: fixtureGroup.specialControls?.length ?? 0,
    errors,
  };
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const inputDir = path.resolve(arg("input-dir", "data/imports/ugmu-first-stream/raw"));
const fixturePath = path.resolve(arg("fixture", "test/fixtures/ugmu/first-stream-2026-autumn.json"));
const outputPath = path.resolve(arg("output", "data/imports/ugmu-first-stream/regression/first-stream-regression.json"));

const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const fixtureGroups = new Map((fixture.groups || []).map((item) => [item.group, item]));
if (fixture.university !== "ugmu" || fixture.program !== "medicine" || fixture.course !== 1 || String(fixture.stream) !== "1") {
  throw new Error("Invalid UGMU first-stream regression fixture identity");
}
if (fixtureGroups.size !== 12 || EXPECTED_GROUPS.some((group) => !fixtureGroups.has(group))) {
  throw new Error("UGMU first-stream fixture must contain exactly ОЛД 101–112");
}

const groupReports = [];
for (const group of EXPECTED_GROUPS) {
  const number = slug(group);
  const rawPath = path.join(inputDir, `OLD-${number}.json`);
  const raw = JSON.parse(await fs.readFile(rawPath, "utf8"));
  const canonical = canonicalizeUgmuWeeklyFirstStream(raw);
  const fixtureGroup = fixtureGroups.get(group);
  const errors = [];

  const fixtureCheck = validateFixture(raw, canonical, fixtureGroup, fixture.sourceSha256);
  errors.push(...fixtureCheck.errors);

  const v1 = prepareVersion(canonical, null, "2026-08-20T17:40:00.000Z", versionId(group, "v1"));
  const p1 = postprocessed(v1.batch);
  const exact = prepareVersion(canonicalizeUgmuWeeklyFirstStream(raw), v1.batch, "2026-08-20T17:45:00.000Z", versionId(group, "unused"));
  const pExact = postprocessed(exact.batch);

  const changedCanonical = canonicalizeUgmuWeeklyFirstStream(raw);
  const changedIndex = findUniqueMutableEvent(changedCanonical.events);
  const changedIncoming = changedCanonical.events[changedIndex];
  changedIncoming.lesson.locations[0] = {
    ...changedIncoming.lesson.locations[0],
    room: "QA-FIRST-STREAM-CHANGE",
  };
  changedIncoming.source.references = [
    ...changedIncoming.source.references,
    { role: "location", range: "synthetic-first-stream-versioning:QA-FIRST-STREAM-CHANGE" },
  ];
  changedIncoming.source.raw_text = `${changedIncoming.source.raw_text} [synthetic first-stream location change]`;

  const v2 = prepareVersion(changedCanonical, v1.batch, "2026-08-20T17:50:00.000Z", versionId(group, "v2"));
  const p2 = postprocessed(v2.batch);
  const targetV1 = p1.batch.events[changedIndex];
  const targetV2 = p2.batch.events.find((event) => event.system.event_id === targetV1.system.event_id);
  const uid = `${targetV1.system.event_id}@ugmu-calendar`;
  const v1Block = eventBlockByUid(p1.ics, uid);
  const exactBlock = eventBlockByUid(pExact.ics, uid);
  const v2Block = eventBlockByUid(p2.ics, uid);

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
  assert(Boolean(targetV2), "synthetic target event_id not preserved", errors);
  assert(targetV2?.system.revision === 2 && targetV1.system.revision === 1, "revision must advance 1 -> 2", errors);
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
    passed: errors.length === 0,
    events: canonical.events.length,
    fixture: fixtureCheck,
    exactReimport: {
      unchanged: exact.diff.counts.unchanged,
      added: exact.diff.counts.added,
      changed: exact.diff.counts.changed,
      removed: exact.diff.counts.removed,
      scheduleVersionStable: exact.batch.schedule.schedule_version_id === v1.batch.schedule.schedule_version_id,
    },
    simulatedChange: {
      synthetic: true,
      targetDate: targetV1.timing.date,
      targetDiscipline: targetV1.lesson.discipline.normalized,
      targetType: targetV1.lesson.type.code,
      targetUid: uid,
      eventIdStable: targetV2?.system.event_id === targetV1.system.event_id,
      revisionV1: targetV1.system.revision,
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
  fixtureControls: groupReports.reduce((sum, item) => sum + item.fixture.controls, 0),
  specialControls: groupReports.reduce((sum, item) => sum + item.fixture.specialControls, 0),
  exactUnchanged: groupReports.reduce((sum, item) => sum + item.exactReimport.unchanged, 0),
  simulatedChanged: groupReports.reduce((sum, item) => sum + item.simulatedChange.changed, 0),
  simulatedUnchanged: groupReports.reduce((sum, item) => sum + item.simulatedChange.unchanged, 0),
  stableUidGroups: groupReports.filter((item) => item.simulatedChange.eventIdStable).length,
  sequenceAdvancedGroups: groupReports.filter((item) => item.simulatedChange.sequenceV1 === "0" && item.simulatedChange.sequenceV2 === "1").length,
};
const passed = groupReports.every((item) => item.passed)
  && totals.groups === 12
  && totals.events === 4286
  && totals.fixtureControls === 36
  && totals.specialControls === 3
  && totals.exactUnchanged === 4286
  && totals.simulatedChanged === 12
  && totals.simulatedUnchanged === 4274
  && totals.stableUidGroups === 12
  && totals.sequenceAdvancedGroups === 12;

const report = {
  version: 1,
  university: "ugmu",
  program: "medicine",
  course: 1,
  stream: "1",
  sourceSha256: fixture.sourceSha256,
  fixture: path.relative(process.cwd(), fixturePath),
  totals,
  groups: groupReports,
  passed,
  publicationAllowed: false,
  nextGate: passed ? "structural-readiness" : "fix-first-stream-regression",
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU first-stream regression: ${passed ? "PASS" : "FAIL"}`);
console.log(`Fixture controls: ${totals.fixtureControls} + ${totals.specialControls} special`);
console.log(`Exact re-import unchanged: ${totals.exactUnchanged}/${totals.events}`);
console.log(`Synthetic changes: changed=${totals.simulatedChanged}; unchanged=${totals.simulatedUnchanged}`);
console.log(`Stable UID groups: ${totals.stableUidGroups}/12; SEQUENCE advanced: ${totals.sequenceAdvancedGroups}/12`);
console.log("Publication allowed: no");
if (!passed) {
  for (const item of groupReports) {
    for (const error of item.errors) console.error(`${item.group}: ${error}`);
  }
  process.exitCode = 2;
}
