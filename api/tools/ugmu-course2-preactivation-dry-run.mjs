import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { scheduleContext, scheduleStorageKey } from "../src/order-context.js";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_TOTAL_EVENTS = 10704;
const EXPECTED_STREAM_EVENTS = { "1": 2788, "2": 2715, "3": 2742, "4": 2459 };
const DEFAULT_GENERATED_AT = "2026-08-22T15:50:00.000Z";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function slug(group) { return String(group).replace(/[^0-9]+/g, ""); }
function eventIdFactory(group) {
  const groupSlug = slug(group);
  return (_event, index) => `evt_ugmu_old${groupSlug}_${String(index + 1).padStart(4, "0")}`;
}
function versionId(group, sourceSha) { return `ver_ugmu_old${slug(group)}_preactivation_${sourceSha.slice(0, 12)}`; }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function rollbackSnapshotKey(storageKey, manifestId) {
  const encoded = storageKey.split("/").at(-1);
  return `rollback/ugmu/course2-preactivation/${manifestId}/${encoded}`;
}

const packageDir = path.resolve(arg("package-dir", "data/imports/ugmu-course2/canonical-package"));
const regressionPath = path.resolve(arg("regression-report", "data/imports/ugmu-course2/versioning/course2-versioning-regression.json"));
const outputDir = path.resolve(arg("output-dir", "data/imports/ugmu-course2/preactivation-dry-run"));
const generatedAt = arg("generated-at", DEFAULT_GENERATED_AT);
const packageManifestText = await fs.readFile(path.join(packageDir, "manifest.json"), "utf8");
const packageManifest = JSON.parse(packageManifestText);
const regression = JSON.parse(await fs.readFile(regressionPath, "utf8"));
if (!packageManifest.passed || packageManifest.publicationAllowed !== false || packageManifest.groups !== 48 || packageManifest.events !== EXPECTED_TOTAL_EVENTS) {
  throw new Error("UGMU course-2 canonical package is not approved fail-closed evidence");
}
if (!regression.passed || regression.publicationAllowed !== false || regression.totals?.groups !== 48 || regression.totals?.events !== EXPECTED_TOTAL_EVENTS) {
  throw new Error("UGMU course-2 versioning regression is not approved fail-closed evidence");
}

const packageManifestSha256 = sha256(packageManifestText);
const manifestId = `ugmu-course2-2026-autumn-${packageManifestSha256.slice(0, 12)}`;
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "groups"), { recursive: true });

const groups = [];
let totalEvents = 0;
for (const group of EXPECTED_GROUPS) {
  const number = slug(group);
  const canonicalPath = path.join(packageDir, "canonical", `${group.replace(" ", "-")}.json`);
  const canonical = JSON.parse(await fs.readFile(canonicalPath, "utf8"));
  const stream = canonical.events?.[0]?.audience?.stream || null;
  const sourceFileHash = canonical.events?.[0]?.source?.file_hash || null;
  const sourceSha256 = String(sourceFileHash || "").replace(/^sha256:/, "");
  const expectedSource = packageManifest.streams?.[stream]?.sourceSha256;
  if (!stream || !Array.isArray(expectedSource) || expectedSource.length !== 1 || expectedSource[0] !== sourceSha256) {
    throw new Error(`${group}: canonical source does not match approved stream source`);
  }

  const prepared = prepareSchedulePublication(canonical, {
    now: generatedAt,
    eventIdFactory: eventIdFactory(group),
    versionIdFactory: () => versionId(group, sourceSha256),
    postprocessOptions: { includeServiceSignature: false, longBreakDays: 14 },
  });
  const context = scheduleContext(prepared.batch);
  const expectedGroupId = `ugmu:medicine:2:stream-${stream}:${group}`;
  if (context.groupId !== expectedGroupId) throw new Error(`${group}: group identity mismatch (${context.groupId})`);
  const storageKey = scheduleStorageKey(prepared.batch);
  const scheduleText = stableJson(prepared.batch);
  const icsText = prepared.ics;
  const pointer = {
    version: 1,
    kind: "ugmu-course2-preactivation-dry-run-pointer",
    manifestId,
    university: "ugmu",
    program: context.program,
    course: context.course,
    stream: context.stream,
    groupId: context.groupId,
    groupCode: context.groupCode,
    academicYear: context.academicYear,
    semester: context.semester,
    sourceSha256,
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
  await Promise.all([
    fs.writeFile(path.join(groupDir, "schedule.json"), scheduleText),
    fs.writeFile(path.join(groupDir, "calendar.ics"), icsText),
    fs.writeFile(path.join(groupDir, "current.json"), pointerText),
  ]);
  const uniqueEventIds = new Set(prepared.batch.events.map((event) => event.system?.event_id).filter(Boolean)).size;
  groups.push({
    group, stream, groupId: context.groupId, sourceSha256, storageKey,
    rollback: { snapshotKey: pointer.rollbackSnapshotKey, strategy: "restore-prestage-snapshot-if-present-otherwise-delete-staged-object", destructiveDuringDryRun: false },
    versionId: prepared.batch.schedule.schedule_version_id,
    eventCount: prepared.batch.events.length,
    uniqueEventIds,
    hashes: { scheduleSha256: sha256(scheduleText), icsSha256: sha256(icsText), currentPointerSha256: sha256(pointerText) },
    qa: { inputPublishable: prepared.inputQa.publishable, outputPublishable: prepared.outputQa.publishable },
  });
  totalEvents += prepared.batch.events.length;
}

const streamTotals = Object.fromEntries(["1", "2", "3", "4"].map((stream) => {
  const items = groups.filter((item) => item.stream === stream);
  return [stream, { groups: items.length, events: items.reduce((sum, item) => sum + item.eventCount, 0) }];
}));
const manifest = {
  version: 1,
  kind: "ugmu-course2-preactivation-schedule-dry-run",
  manifestId,
  generatedAt,
  university: "ugmu",
  upstream: {
    canonicalPackageManifestSha256: packageManifestSha256,
    canonicalPackagePassed: packageManifest.passed,
    versioningRegressionPassed: regression.passed,
  },
  scope: {
    program: "medicine", course: 2, streams: ["1", "2", "3", "4"], academicYear: "2026/2027", semester: 1,
    groups: EXPECTED_GROUPS,
    sourceSha256ByStream: Object.fromEntries(Object.entries(packageManifest.streams).map(([stream, value]) => [stream, value.sourceSha256[0]])),
  },
  totals: {
    groups: groups.length, events: totalEvents, streams: streamTotals,
    storageObjectsPlanned: groups.length, rollbackPointers: groups.length,
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
    catalogChanged: false,
  },
  checks: {
    exactGroupSet: groups.length === 48 && groups.every((item, index) => item.group === EXPECTED_GROUPS[index]),
    exactEventTotal: totalEvents === EXPECTED_TOTAL_EVENTS,
    exactStreamGroups: ["1", "2", "3", "4"].every((stream) => streamTotals[stream].groups === 12),
    exactStreamEvents: ["1", "2", "3", "4"].every((stream) => streamTotals[stream].events === EXPECTED_STREAM_EVENTS[stream]),
    uniqueStorageKeys: new Set(groups.map((item) => item.storageKey)).size === 48,
    uniqueRollbackPointers: new Set(groups.map((item) => item.rollback.snapshotKey)).size === 48,
    allQaPublishable: groups.every((item) => item.qa.inputPublishable && item.qa.outputPublishable),
    allEventIdsUniqueWithinGroup: groups.every((item) => item.uniqueEventIds === item.eventCount),
    allStorageKeysUgmuNamespaced: groups.every((item) => item.storageKey.startsWith("schedules/ugmu/medicine/2/2026-2027/semester-1/")),
    allRollbackKeysUgmuNamespaced: groups.every((item) => item.rollback.snapshotKey.startsWith(`rollback/ugmu/course2-preactivation/${manifestId}/`)),
  },
  activationAuthority: {
    granted: false,
    stagingWriteAuthority: false,
    salesAuthority: false,
    reason: "Deterministic course-2 dry-run only; production storage staging requires a separate fail-closed authority and rollback gate.",
  },
  publicationAllowed: false,
  nextRequiredBoundary: "course2-production-storage-staging-review",
};
manifest.passed = Object.values(manifest.checks).every(Boolean)
  && manifest.safety.productionMutationPerformed === false
  && manifest.publicationAllowed === false;
await fs.writeFile(path.join(outputDir, "manifest.json"), stableJson(manifest));
console.log(`UGMU course-2 preactivation dry-run: ${manifest.passed ? "PASS" : "FAIL"}`);
console.log(`Groups: ${manifest.totals.groups}; events: ${manifest.totals.events}`);
console.log(`Stable production objects planned: ${manifest.totals.storageObjectsPlanned}`);
console.log("Production mutation performed: no");
console.log(`Next boundary: ${manifest.nextRequiredBoundary}`);
if (!manifest.passed) process.exitCode = 2;
