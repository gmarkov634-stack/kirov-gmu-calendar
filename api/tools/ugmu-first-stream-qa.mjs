import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuWeeklyFirstStream } from "../src/adapters/ugmu/canonical.mjs";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";

const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);
const EXPECTED_TOTAL_EVENTS = 4286;
const EXPECTED_TOTAL_LECTURES = 1344;

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
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

const inputDir = path.resolve(arg("input-dir", "data/imports/ugmu-first-stream/raw"));
const outputDir = path.resolve(arg("output-dir", "data/imports/ugmu-first-stream/qa"));
const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const rawSchedules = [];
for (const file of files) {
  rawSchedules.push(JSON.parse(await fs.readFile(path.join(inputDir, file), "utf8")));
}

const byGroup = new Map(rawSchedules.map((schedule) => [schedule?.group?.code, schedule]));
const actualGroups = [...byGroup.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
if (JSON.stringify(actualGroups) !== JSON.stringify(EXPECTED_GROUPS)) {
  throw new Error(`UGMU first-stream group set mismatch: ${JSON.stringify(actualGroups)}`);
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "canonical"), { recursive: true });
await fs.mkdir(path.join(outputDir, "postprocessed"), { recursive: true });

const groups = [];
for (const group of EXPECTED_GROUPS) {
  const raw = byGroup.get(group);
  const canonical = canonicalizeUgmuWeeklyFirstStream(raw);
  const inputQa = validateScheduleBatch(canonical);
  const processed = postprocessSchedule(canonical, {
    includeServiceSignature: false,
    longBreakDays: 14,
  });
  const outputQa = validatePostprocessedSchedule(processed);
  const sha256 = raw.sources?.[0]?.sha256 || null;
  const hashMismatch = sourceHashMismatch(processed, sha256);
  const signatures = serviceSignatureCount(processed);
  const lectureEvents = processed.events.filter((event) => event.lesson?.type?.code === "lecture").length;
  const otherEvents = processed.events.filter((event) => event.lesson?.type?.code === "other").length;
  const rawErrors = Array.isArray(raw.validationErrors) ? raw.validationErrors : ["missing validationErrors"];
  const sourceOverlaps = raw.sourceReview?.sourceOverlaps || [];
  const approved = (
    raw.sourceReview?.status === "semantic-reviewed-first-stream"
    && raw.sourceReview?.publicationAllowed === false
    && rawErrors.length === 0
    && inputQa.publishable
    && outputQa.publishable
    && hashMismatch === 0
    && signatures === 0
  );

  const stem = group.replace(" ", "-");
  await fs.writeFile(
    path.join(outputDir, "canonical", `${stem}.json`),
    `${JSON.stringify(canonical, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputDir, "postprocessed", `${stem}.json`),
    `${JSON.stringify(processed, null, 2)}\n`,
  );

  groups.push({
    group,
    approved,
    sourceSha256: sha256,
    patterns: raw.patterns?.length ?? 0,
    events: processed.events.length,
    lectures: lectureEvents,
    other: otherEvents,
    uniqueDates: new Set(processed.events.map((event) => event.timing?.date)).size,
    importWarnings: raw.importWarnings?.length ?? 0,
    semanticDecisions: raw.sourceReview?.semanticDecisions?.length ?? 0,
    sourceAnomalies: raw.sourceReview?.sourceAnomalies?.length ?? 0,
    sourceOverlaps: sourceOverlaps.length,
    inputQa: inputQa.publishable,
    outputQa: outputQa.publishable,
    sourceHashMismatch: hashMismatch,
    serviceSignatures: signatures,
    rawErrors,
  });
}

const uniqueSourceHashes = [...new Set(groups.map((item) => item.sourceSha256))];
const totalEvents = groups.reduce((sum, item) => sum + item.events, 0);
const totalLectures = groups.reduce((sum, item) => sum + item.lectures, 0);
const old102 = groups.find((item) => item.group === "ОЛД 102");
const allApproved = groups.every((item) => item.approved);
const crossGroupChecks = {
  exactGroupCount: groups.length === 12,
  oneExactSourceSha: uniqueSourceHashes.length === 1 && Boolean(uniqueSourceHashes[0]),
  allHave23Patterns: groups.every((item) => item.patterns === 23),
  totalEventsMatch: totalEvents === EXPECTED_TOTAL_EVENTS,
  totalLecturesMatch: totalLectures === EXPECTED_TOTAL_LECTURES,
  old102KnownSourceOverlapPreserved: old102?.sourceOverlaps === 19 && old102?.sourceAnomalies === 1,
  allSourceHashesBound: groups.every((item) => item.sourceHashMismatch === 0),
  noServiceAdvertising: groups.every((item) => item.serviceSignatures === 0),
};
const crossGroupPassed = Object.values(crossGroupChecks).every(Boolean);

const report = {
  version: 1,
  university: "ugmu",
  program: "medicine",
  course: 1,
  stream: "1",
  groups,
  totals: {
    groups: groups.length,
    patterns: groups.reduce((sum, item) => sum + item.patterns, 0),
    events: totalEvents,
    lectures: totalLectures,
    other: groups.reduce((sum, item) => sum + item.other, 0),
    semanticDecisions: groups.reduce((sum, item) => sum + item.semanticDecisions, 0),
    sourceAnomalies: groups.reduce((sum, item) => sum + item.sourceAnomalies, 0),
    sourceOverlaps: groups.reduce((sum, item) => sum + item.sourceOverlaps, 0),
  },
  sourceSha256: uniqueSourceHashes.length === 1 ? uniqueSourceHashes[0] : null,
  crossGroupChecks,
  crossGroupPassed,
  allApproved: allApproved && crossGroupPassed,
  publicationAllowed: false,
  nextGate: allApproved && crossGroupPassed ? "first-stream-versioning-and-regression-fixtures" : "fix-first-stream-qa",
};

await fs.writeFile(path.join(outputDir, "first-stream-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU first stream: ${groups.filter((item) => item.approved).length}/12 groups QA-approved`);
console.log(`Events: ${totalEvents}; lectures: ${totalLectures}`);
console.log(`Known source overlaps preserved: ${report.totals.sourceOverlaps}`);
console.log(`Cross-group checks: ${crossGroupPassed ? "PASS" : "FAIL"}`);
console.log(`Publication allowed: no`);
if (!report.allApproved) process.exitCode = 2;
