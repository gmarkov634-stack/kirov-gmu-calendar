import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuMedicineCourse1Reviewed } from "../src/adapters/ugmu/canonical.mjs";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";

const EXPECTED_GROUPS = Array.from({ length: 50 }, (_, index) => `ОЛД ${101 + index}`);
const EXPECTED_STREAMS = {
  "1": {
    groups: 12,
    events: 4286,
    sourceSha256: "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8",
  },
  "2": {
    groups: 12,
    events: 4263,
    sourceSha256: "722300a869f7ecb2939aaa240463ca7b8d6c566c60a98ae90181d67d2c7e44ca",
  },
  "3": {
    groups: 12,
    events: 4026,
    sourceSha256: "248f436baa3254ee891506628b05e945bddfbb708616ec5e38b34e7d893783ca",
  },
  "4": {
    groups: 14,
    events: 4726,
    sourceSha256: "5fa092b9eac42190cf06a927f30d4b6442a5c159bea94f95da484c44b050e90d",
  },
};
const EXPECTED_TOTAL_EVENTS = Object.values(EXPECTED_STREAMS).reduce((sum, item) => sum + item.events, 0);

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
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function isCourse1Schedule(value) {
  return value?.university === "ugmu"
    && value?.program === "medicine"
    && value?.course === 1
    && /^ОЛД\s+(10[1-9]|1[1-4][0-9]|150)$/.test(value?.group?.code || "");
}

function sourceHashMismatch(batch, sha256) {
  const expected = sha256 ? `sha256:${sha256}` : null;
  return batch.events.filter((event) => event.source?.file_hash !== expected).length;
}

function serviceSignatureCount(batch) {
  return batch.events.filter((event) =>
    /gmarkov634-stack\.github\.io\/kirov-gmu-calendar/i.test(event.calendar?.description || "")
  ).length;
}

function reviewCount(raw, field) {
  return Array.isArray(raw.sourceReview?.[field]) ? raw.sourceReview[field].length : 0;
}

const inputDir = path.resolve(arg("input-dir", "data/imports/ugmu-course1/raw"));
const outputDir = path.resolve(arg("output-dir", "data/imports/ugmu-course1/canonical-package"));

const rawSchedules = [];
for (const file of await jsonFilesRecursive(inputDir)) {
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (isCourse1Schedule(value)) rawSchedules.push(value);
}

const byGroup = new Map();
for (const raw of rawSchedules) {
  const group = raw.group.code;
  if (byGroup.has(group)) throw new Error(`Duplicate UGMU course-1 raw schedule: ${group}`);
  byGroup.set(group, raw);
}

const actualGroups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
if (JSON.stringify(actualGroups) !== JSON.stringify(EXPECTED_GROUPS)) {
  throw new Error(`UGMU course-1 group set mismatch: expected 101-150, got ${JSON.stringify(actualGroups)}`);
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "canonical"), { recursive: true });
await fs.mkdir(path.join(outputDir, "postprocessed"), { recursive: true });
await fs.mkdir(path.join(outputDir, "qa"), { recursive: true });

const groups = [];
for (const group of EXPECTED_GROUPS) {
  const raw = byGroup.get(group);
  const stream = String(raw.stream);
  const baseline = EXPECTED_STREAMS[stream];
  if (!baseline) throw new Error(`Unexpected UGMU course-1 stream for ${group}: ${stream}`);

  const sourceSha256 = raw.sources?.[0]?.sha256 || null;
  const canonical = canonicalizeUgmuMedicineCourse1Reviewed(raw);
  const inputQa = validateScheduleBatch(canonical);
  const postprocessed = postprocessSchedule(canonical, {
    includeServiceSignature: false,
    longBreakDays: 14,
  });
  const outputQa = validatePostprocessedSchedule(postprocessed);
  const hashMismatch = sourceHashMismatch(postprocessed, sourceSha256);
  const serviceSignatures = serviceSignatureCount(postprocessed);
  const approved = (
    raw.sourceReview?.publicationAllowed === false
    && sourceSha256 === baseline.sourceSha256
    && inputQa.publishable
    && outputQa.publishable
    && hashMismatch === 0
    && serviceSignatures === 0
  );

  const stem = group.replace(" ", "-");
  await Promise.all([
    fs.writeFile(path.join(outputDir, "canonical", `${stem}.json`), `${JSON.stringify(canonical, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, "postprocessed", `${stem}.json`), `${JSON.stringify(postprocessed, null, 2)}\n`),
  ]);

  const qa = {
    group,
    stream,
    approved,
    publicationAllowed: false,
    sourceReviewStatus: raw.sourceReview?.status || null,
    sourceSha256,
    patterns: raw.patterns?.length ?? 0,
    events: postprocessed.events.length,
    lectures: postprocessed.events.filter((event) => event.lesson?.type?.code === "lecture").length,
    inputQa: inputQa.publishable,
    outputQa: outputQa.publishable,
    sourceHashMismatch: hashMismatch,
    serviceSignatures,
    semanticDecisions: reviewCount(raw, "semanticDecisions"),
    sourceReferenceOmissions: reviewCount(raw, "sourceReferenceOmissions"),
    sourceAnomalies: reviewCount(raw, "sourceAnomalies"),
    sourceDefects: reviewCount(raw, "sourceDefects"),
    sourceAmbiguities: reviewCount(raw, "sourceAmbiguities"),
    sourceOverlaps: reviewCount(raw, "sourceOverlaps"),
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
    sourceDefects: items.reduce((sum, item) => sum + item.sourceDefects, 0),
    sourceAmbiguities: items.reduce((sum, item) => sum + item.sourceAmbiguities, 0),
    sourceOverlaps: items.reduce((sum, item) => sum + item.sourceOverlaps, 0),
  };
}

const streamChecks = Object.fromEntries(Object.entries(EXPECTED_STREAMS).map(([stream, expected]) => {
  const actual = streams[stream];
  return [stream, {
    groupCount: actual.groups === expected.groups,
    allGroupsApproved: actual.approvedGroups === expected.groups,
    eventCount: actual.events === expected.events,
    exactSourceSha: actual.sourceSha256.length === 1 && actual.sourceSha256[0] === expected.sourceSha256,
  }];
}));

const old129 = groups.find((item) => item.group === "ОЛД 129");
const globalChecks = {
  exactGroupCount: groups.length === 50,
  exactEventCount: groups.reduce((sum, item) => sum + item.events, 0) === EXPECTED_TOTAL_EVENTS,
  allGroupsApproved: groups.every((item) => item.approved),
  allFailClosed: groups.every((item) => item.publicationAllowed === false),
  allSourceHashesBound: groups.every((item) => item.sourceHashMismatch === 0),
  noServiceAdvertising: groups.every((item) => item.serviceSignatures === 0),
  old129OfficialDefectPreserved: old129?.sourceDefects === 1
    && old129?.sourceReviewStatus === "semantic-reviewed-stream-3-with-source-defect-and-ambiguity",
};

const passed = Object.values(globalChecks).every(Boolean)
  && Object.values(streamChecks).every((checks) => Object.values(checks).every(Boolean));

const manifest = {
  version: 1,
  university: "ugmu",
  program: "medicine",
  course: 1,
  academicYear: "2026/2027",
  semester: 1,
  groups: groups.length,
  events: groups.reduce((sum, item) => sum + item.events, 0),
  streams,
  streamChecks,
  globalChecks,
  passed,
  publicationAllowed: false,
  nextGate: passed ? "production-storage-stage-review" : "fix-course1-canonical-package",
};

await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`UGMU medicine course 1 canonical package: ${groups.filter((item) => item.approved).length}/50 groups approved`);
console.log(`Events: ${manifest.events}/${EXPECTED_TOTAL_EVENTS}`);
console.log(`Package QA: ${passed ? "PASS" : "FAIL"}`);
console.log("Publication allowed: no");
if (!passed) process.exitCode = 2;
