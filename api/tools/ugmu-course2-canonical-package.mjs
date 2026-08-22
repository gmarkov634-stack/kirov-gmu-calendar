import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuMedicineCourse2Reviewed } from "../src/adapters/ugmu/canonical.mjs";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_STREAMS = {
  "1": { groups: 12, events: 2788, sourceSha256: "8b81f37b517dd037c090b0d980ba4d916557f36c872fe0fc37031d4ae8808c6a" },
  "2": { groups: 12, events: 2715, sourceSha256: "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd" },
  "3": { groups: 12, events: 2742, sourceSha256: "b6cc586f29a20bd008b5da89129809db7fbed8b2a9224a9f2d4cd3e3a77a9b85" },
  "4": { groups: 12, events: 2459, sourceSha256: "6b5f87dc7f565169105245a397996e61e94794dfe580529cc5f7398a62e21517" },
};
const EXPECTED_TOTAL_EVENTS = 10704;
const EXPECTED_REFERENCE_CORRECTIONS = 27;
const EXPECTED_CONFIRMED_OVERLAPS = 32;

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function jsonFilesRecursive(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFilesRecursive(full));
    else if (entry.isFile() && /^ОЛД-\d{3}\.json$/u.test(entry.name)) files.push(full);
  }
  return files;
}

function sourceHashMismatch(batch, sha256) {
  const expected = `sha256:${sha256}`;
  return batch.events.filter((event) => event.source?.file_hash !== expected).length;
}

function serviceSignatureCount(batch) {
  return batch.events.filter((event) => /gmarkov634-stack\.github\.io\/kirov-gmu-calendar/i.test(event.calendar?.description || "")).length;
}

function reviewCount(raw, field) {
  return Array.isArray(raw.sourceReview?.[field]) ? raw.sourceReview[field].length : 0;
}

const inputDir = path.resolve(arg("input-dir", "data/imports/ugmu-course2/raw"));
const outputDir = path.resolve(arg("output-dir", "data/imports/ugmu-course2/canonical-package"));
const rawSchedules = [];
for (const file of await jsonFilesRecursive(inputDir)) {
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (value?.university === "ugmu" && value?.program === "medicine" && value?.course === 2 && /^ОЛД\s+2\d{2}$/u.test(value?.group?.code || "")) rawSchedules.push(value);
}

const byGroup = new Map();
for (const raw of rawSchedules) {
  const group = raw.group.code;
  if (byGroup.has(group)) throw new Error(`Duplicate UGMU course-2 raw schedule: ${group}`);
  byGroup.set(group, raw);
}
const actualGroups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
if (JSON.stringify(actualGroups) !== JSON.stringify(EXPECTED_GROUPS)) throw new Error(`UGMU course-2 group set mismatch: ${JSON.stringify(actualGroups)}`);

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "canonical"), { recursive: true });
await fs.mkdir(path.join(outputDir, "postprocessed"), { recursive: true });
await fs.mkdir(path.join(outputDir, "qa"), { recursive: true });

const groups = [];
for (const group of EXPECTED_GROUPS) {
  const raw = byGroup.get(group);
  const stream = String(raw.stream);
  const baseline = EXPECTED_STREAMS[stream];
  if (!baseline) throw new Error(`${group}: unexpected stream ${stream}`);
  const sourceSha256 = raw.sources?.[0]?.sha256 || null;
  const canonical = canonicalizeUgmuMedicineCourse2Reviewed(raw);
  const inputQa = validateScheduleBatch(canonical);
  const postprocessed = postprocessSchedule(canonical, { includeServiceSignature: false, longBreakDays: 14 });
  const outputQa = validatePostprocessedSchedule(postprocessed);
  const hashMismatch = sourceHashMismatch(postprocessed, sourceSha256);
  const serviceSignatures = serviceSignatureCount(postprocessed);
  const referenceCorrections = reviewCount(raw, "referenceCorrections");
  const sourceOverlaps = reviewCount(raw, "sourceOverlaps");
  const confirmedOverlaps = Number(raw.sourceReview?.confirmedSourceOverlapCount || 0);
  const approved = raw.sourceReview?.publicationAllowed === false
    && raw.sourceReview?.status === "source-anomalies-reviewed"
    && sourceSha256 === baseline.sourceSha256
    && inputQa.publishable && outputQa.publishable
    && hashMismatch === 0 && serviceSignatures === 0
    && reviewCount(raw, "unresolvedReferences") === 0
    && sourceOverlaps === confirmedOverlaps;

  const stem = group.replace(" ", "-");
  await Promise.all([
    fs.writeFile(path.join(outputDir, "canonical", `${stem}.json`), `${JSON.stringify(canonical, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, "postprocessed", `${stem}.json`), `${JSON.stringify(postprocessed, null, 2)}\n`),
  ]);
  const qa = {
    group, stream, approved, publicationAllowed: false, sourceReviewStatus: raw.sourceReview?.status || null,
    sourceSha256, patterns: raw.patterns?.length ?? 0, events: postprocessed.events.length,
    lectures: postprocessed.events.filter((event) => event.lesson?.type?.code === "lecture").length,
    inputQa: inputQa.publishable, outputQa: outputQa.publishable, sourceHashMismatch: hashMismatch,
    serviceSignatures, referenceCorrections, sourceCorrections: reviewCount(raw, "sourceCorrections"),
    sourceOverlaps, confirmedOverlaps, unresolvedReferences: reviewCount(raw, "unresolvedReferences"),
    rawValidationErrors: raw.validationErrors || [],
  };
  groups.push(qa);
  await fs.writeFile(path.join(outputDir, "qa", `${stem}.qa.json`), `${JSON.stringify(qa, null, 2)}\n`);
}

const streams = {};
for (const stream of Object.keys(EXPECTED_STREAMS)) {
  const items = groups.filter((item) => item.stream === stream);
  streams[stream] = {
    groups: items.length,
    approvedGroups: items.filter((item) => item.approved).length,
    events: items.reduce((sum, item) => sum + item.events, 0),
    sourceSha256: [...new Set(items.map((item) => item.sourceSha256))],
    referenceCorrections: items.reduce((sum, item) => sum + item.referenceCorrections, 0),
    sourceCorrections: items.reduce((sum, item) => sum + item.sourceCorrections, 0),
    sourceOverlaps: items.reduce((sum, item) => sum + item.sourceOverlaps, 0),
    confirmedOverlaps: items.reduce((sum, item) => sum + item.confirmedOverlaps, 0),
  };
}
const streamChecks = Object.fromEntries(Object.entries(EXPECTED_STREAMS).map(([stream, expected]) => [stream, {
  groupCount: streams[stream].groups === expected.groups,
  allGroupsApproved: streams[stream].approvedGroups === expected.groups,
  eventCount: streams[stream].events === expected.events,
  exactSourceSha: streams[stream].sourceSha256.length === 1 && streams[stream].sourceSha256[0] === expected.sourceSha256,
}]));
const globalChecks = {
  exactGroupCount: groups.length === 48,
  exactEventCount: groups.reduce((sum, item) => sum + item.events, 0) === EXPECTED_TOTAL_EVENTS,
  allGroupsApproved: groups.every((item) => item.approved),
  allFailClosed: groups.every((item) => item.publicationAllowed === false),
  allSourceHashesBound: groups.every((item) => item.sourceHashMismatch === 0),
  noServiceAdvertising: groups.every((item) => item.serviceSignatures === 0),
  exactReferenceCorrections: groups.reduce((sum, item) => sum + item.referenceCorrections, 0) === EXPECTED_REFERENCE_CORRECTIONS,
  exactConfirmedSourceOverlaps: groups.reduce((sum, item) => sum + item.confirmedOverlaps, 0) === EXPECTED_CONFIRMED_OVERLAPS,
  noUnresolvedReferences: groups.every((item) => item.unresolvedReferences === 0),
  old247248OverlapOnly: groups.filter((item) => item.sourceOverlaps > 0).every((item) => ["ОЛД 247", "ОЛД 248"].includes(item.group))
    && groups.filter((item) => ["ОЛД 247", "ОЛД 248"].includes(item.group)).every((item) => item.sourceOverlaps === 16 && item.confirmedOverlaps === 16),
};
const passed = Object.values(globalChecks).every(Boolean) && Object.values(streamChecks).every((checks) => Object.values(checks).every(Boolean));
const manifest = {
  version: 1, university: "ugmu", program: "medicine", course: 2, academicYear: "2026/2027", semester: 1,
  groups: groups.length, events: groups.reduce((sum, item) => sum + item.events, 0), streams, streamChecks, globalChecks, passed,
  publicationAllowed: false,
  nextGate: passed ? "course2-versioning-regression" : "fix-course2-canonical-package",
};
await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`UGMU medicine course 2 canonical package: ${groups.filter((item) => item.approved).length}/48 groups approved`);
console.log(`Events: ${manifest.events}/${EXPECTED_TOTAL_EVENTS}`);
console.log(`Package QA: ${passed ? "PASS" : "FAIL"}`);
console.log("Publication allowed: no");
if (!passed) process.exitCode = 2;
