import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuWeeklyFirstStream } from "../src/adapters/ugmu/canonical.mjs";
import { scheduleContext, scheduleStorageKey } from "../src/order-context.js";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);
const EXPECTED_SOURCE_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const EXPECTED_TOTAL_EVENTS = 4286;
const DEFAULT_GENERATED_AT = "2026-08-20T21:00:00.000Z";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(group) {
  return String(group).replace(/[^0-9]+/g, "");
}

function eventIdFactory(group) {
  const groupSlug = slug(group);
  return (_event, index) => `evt_ugmu_old${groupSlug}_${String(index + 1).padStart(4, "0")}`;
}

function versionId(group, sourceSha) {
  return `ver_ugmu_old${slug(group)}_preactivation_${sourceSha.slice(0, 12)}`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function rollbackSnapshotKey(storageKey, manifestId) {
  const encoded = storageKey.split("/").at(-1);
  return `rollback/ugmu/preactivation/${manifestId}/${encoded}`;
}

const inputDir = path.resolve(arg("input-dir", "data/imports/ugmu-first-stream/raw"));
const qaPath = path.resolve(arg("qa-report", "data/imports/ugmu-first-stream/qa/first-stream-qa.json"));
const regressionPath = path.resolve(arg("regression-report", "data/imports/ugmu-first-stream/regression/first-stream-regression.json"));
const outputDir = path.resolve(arg("output-dir", "data/imports/ugmu-preactivation-dry-run"));
const generatedAt = arg("generated-at", DEFAULT_GENERATED_AT);

const qa = JSON.parse(await fs.readFile(qaPath, "utf8"));
const regression = JSON.parse(await fs.readFile(regressionPath, "utf8"));
if (!qa.allApproved || !qa.crossGroupPassed || qa.publicationAllowed !== false) {
  throw new Error("UGMU first-stream QA report is not approved fail-closed evidence");
}
if (!regression.passed || regression.publicationAllowed !== false) {
  throw new Error("UGMU first-stream regression report is not approved fail-closed evidence");
}
if (qa.sourceSha256 !== EXPECTED_SOURCE_SHA || regression.sourceSha256 !== EXPECTED_SOURCE_SHA) {
  throw new Error("UGMU dry-run source SHA differs from the reviewed launch source");
}
if (qa.totals?.groups !== 12 || qa.totals?.events !== EXPECTED_TOTAL_EVENTS) {
  throw new Error("UGMU dry-run QA totals differ from launch scope");
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "groups"), { recursive: true });

const manifestId = `ugmu-first-stream-${EXPECTED_SOURCE_SHA.slice(0, 12)}`;
const groups = [];
let totalEvents = 0;

for (const group of EXPECTED_GROUPS) {
  const number = slug(group);
  const raw = JSON.parse(await fs.readFile(path.join(inputDir, `OLD-${number}.json`), "utf8"));
  if (raw.sources?.[0]?.sha256 !== EXPECTED_SOURCE_SHA) throw new Error(`${group}: source SHA mismatch`);
  if (raw.sourceReview?.status !== "semantic-reviewed-first-stream" || raw.sourceReview?.publicationAllowed !== false) {
    throw new Error(`${group}: semantic review boundary is not fail-closed approved`);
  }

  const canonical = canonicalizeUgmuWeeklyFirstStream(raw);
  const prepared = prepareSchedulePublication(canonical, {
    now: generatedAt,
    eventIdFactory: eventIdFactory(group),
    versionIdFactory: () => versionId(group, EXPECTED_SOURCE_SHA),
    postprocessOptions: {
      includeServiceSignature: false,
      longBreakDays: 14,
    },
  });

  const context = scheduleContext(prepared.batch);
  const storageKey = scheduleStorageKey(prepared.batch);
  const scheduleText = stableJson(prepared.batch);
  const icsText = prepared.ics;
  const pointer = {
    version: 1,
    kind: "ugmu-preactivation-dry-run-pointer",
    manifestId,
    university: "ugmu",
    program: context.program,
    course: context.course,
    stream: context.stream,
    groupId: context.groupId,
    groupCode: context.groupCode,
    academicYear: context.academicYear,
    semester: context.semester,
    sourceSha256: EXPECTED_SOURCE_SHA,
    scheduleVersionId: prepared.batch.schedule.schedule_version_id,
    eventCount: prepared.batch.events.length,
    storageKey,
    rollbackSnapshotKey: rollbackSnapshotKey(storageKey, manifestId),
    state: "dry-run-only",
    publicationAllowed: false,
    productionWriteAllowed: false,
  };
  const pointerText = stableJson(pointer);

  const groupDir = path.join(outputDir, "groups", `OLD-${number}`);
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(path.join(groupDir, "schedule.json"), scheduleText);
  await fs.writeFile(path.join(groupDir, "calendar.ics"), icsText);
  await fs.writeFile(path.join(groupDir, "current.json"), pointerText);

  const firstUid = prepared.batch.events[0]?.system?.event_id
    ? `${prepared.batch.events[0].system.event_id}@ugmu-calendar`
    : null;
  const uniqueUids = new Set(prepared.batch.events.map((event) => event.system?.event_id)).size;
  const record = {
    group,
    groupId: context.groupId,
    storageKey,
    rollback: {
      snapshotKey: pointer.rollbackSnapshotKey,
      strategy: "restore-prestage-snapshot-if-present-otherwise-delete-staged-object",
      destructiveDuringDryRun: false,
    },
    versionId: prepared.batch.schedule.schedule_version_id,
    eventCount: prepared.batch.events.length,
    firstUid,
    uniqueEventIds: uniqueUids,
    hashes: {
      scheduleSha256: sha256(scheduleText),
      icsSha256: sha256(icsText),
      currentPointerSha256: sha256(pointerText),
    },
    qa: {
      inputPublishable: prepared.inputQa.publishable,
      outputPublishable: prepared.outputQa.publishable,
    },
  };
  groups.push(record);
  totalEvents += record.eventCount;
}

const manifest = {
  version: 1,
  kind: "ugmu-preactivation-schedule-dry-run",
  manifestId,
  generatedAt,
  university: "ugmu",
  scope: {
    program: "medicine",
    course: 1,
    stream: "1",
    academicYear: "2026/2027",
    semester: 1,
    groups: EXPECTED_GROUPS,
    sourceSha256: EXPECTED_SOURCE_SHA,
  },
  totals: {
    groups: groups.length,
    events: totalEvents,
    storageObjectsPlanned: groups.length,
    rollbackPointers: groups.length,
  },
  groups,
  safety: {
    dryRun: true,
    productionMutationPerformed: false,
    s3WritePerformed: false,
    cloudruMutationPerformed: false,
    registryActiveChanged: false,
    checkoutChanged: false,
    publicEndpointsChanged: false,
    trialsChanged: false,
  },
  checks: {
    exactGroupSet: groups.length === 12 && groups.every((item, index) => item.group === EXPECTED_GROUPS[index]),
    exactEventTotal: totalEvents === EXPECTED_TOTAL_EVENTS,
    uniqueStorageKeys: new Set(groups.map((item) => item.storageKey)).size === 12,
    uniqueRollbackPointers: new Set(groups.map((item) => item.rollback.snapshotKey)).size === 12,
    allQaPublishable: groups.every((item) => item.qa.inputPublishable && item.qa.outputPublishable),
    allEventIdsUniqueWithinGroup: groups.every((item) => item.uniqueEventIds === item.eventCount),
    allStorageKeysUgmuNamespaced: groups.every((item) => item.storageKey.startsWith("schedules/ugmu/medicine/1/2026-2027/semester-1/")),
    allRollbackKeysUgmuNamespaced: groups.every((item) => item.rollback.snapshotKey.startsWith(`rollback/ugmu/preactivation/${manifestId}/`)),
  },
  activationAuthority: {
    granted: false,
    stagingWriteAuthority: false,
    salesAuthority: false,
    reason: "This artifact is a deterministic dry-run manifest only. Step 23 requires a separate controlled staging action.",
  },
  nextRequiredBoundary: "preactivation-production-storage-staging",
};
manifest.passed = Object.values(manifest.checks).every(Boolean)
  && manifest.totals.groups === 12
  && manifest.totals.events === EXPECTED_TOTAL_EVENTS
  && manifest.safety.productionMutationPerformed === false;

await fs.writeFile(path.join(outputDir, "manifest.json"), stableJson(manifest));
console.log(`UGMU production dry-run: ${manifest.passed ? "PASS" : "FAIL"}`);
console.log(`Groups: ${manifest.totals.groups}; events: ${manifest.totals.events}`);
console.log(`Planned production storage objects: ${manifest.totals.storageObjectsPlanned}`);
console.log(`Rollback pointers: ${manifest.totals.rollbackPointers}`);
console.log("Production mutation performed: no");
console.log(`Next boundary: ${manifest.nextRequiredBoundary}`);
if (!manifest.passed) process.exitCode = 2;
