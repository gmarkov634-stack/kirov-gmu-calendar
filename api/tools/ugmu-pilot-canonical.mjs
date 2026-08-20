import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuWeeklyPilot } from "../src/adapters/ugmu/canonical.mjs";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function minutes(value) {
  const [hours, mins] = String(value || "").split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
}

function overlapCount(events) {
  const byDate = new Map();
  for (const event of events) {
    const date = event.timing.date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(event);
  }
  let count = 0;
  for (const day of byDate.values()) {
    day.sort((a, b) => (minutes(a.timing.start_time) ?? 9999) - (minutes(b.timing.start_time) ?? 9999));
    for (let index = 1; index < day.length; index += 1) {
      const previousEnd = minutes(day[index - 1].timing.end_time);
      const currentStart = minutes(day[index].timing.start_time);
      if (previousEnd !== null && currentStart !== null && currentStart < previousEnd) count += 1;
    }
  }
  return count;
}

function customQa(raw, canonical, processed) {
  const errors = [];
  const sourceHash = raw.sources?.[0]?.sha256 || null;
  const expectedHash = sourceHash ? `sha256:${sourceHash}` : null;
  const lectureEvents = processed.events.filter((event) => event.lesson.type.code === "lecture");
  const otherEvents = processed.events.filter((event) => event.lesson.type.code === "other");
  const noFabricatedAddress = processed.events.filter((event) =>
    /место проведения занятий определяет/i.test(event.lesson.source_note || "") && event.lesson.locations.length > 0
  );
  const serviceSignatures = processed.events.filter((event) =>
    /gmarkov634-stack\.github\.io\/kirov-gmu-calendar/i.test(event.calendar.description || "")
  );
  const badLectureTitles = lectureEvents.filter((event) => !/^ЛЕКЦ\.\s+[А-ЯЁ0-9]/.test(event.calendar.title || ""));
  const missingSequence = processed.events.filter((event) =>
    !Number.isInteger(event.derived.sequence?.index) || !Number.isInteger(event.derived.sequence?.total)
  );
  const inconsistentLast = processed.events.filter((event) =>
    event.derived.is_last_same_event !== (event.derived.sequence.index === event.derived.sequence.total)
  );
  const sourceHashMismatch = canonical.events.filter((event) => event.source.file_hash !== expectedHash);

  if (raw.group?.code !== "ОЛД 101") errors.push("pilot group is not ОЛД 101");
  if (raw.patterns?.length !== 23) errors.push(`expected 23 reviewed patterns, got ${raw.patterns?.length ?? 0}`);
  if (processed.events.length !== 357) errors.push(`expected 357 events, got ${processed.events.length}`);
  if (lectureEvents.length !== 112) errors.push(`expected 112 lecture events, got ${lectureEvents.length}`);
  if (otherEvents.length !== 245) errors.push(`expected 245 non-lecture events, got ${otherEvents.length}`);
  if (overlapCount(processed.events) !== 0) errors.push("time overlaps detected in OLD 101");
  if (noFabricatedAddress.length) errors.push("fabricated address found for department-defined location");
  if (serviceSignatures.length) errors.push("service advertising must be disabled in pilot postprocessing");
  if (badLectureTitles.length) errors.push("lecture title formatting mismatch");
  if (missingSequence.length) errors.push("missing X из N sequence metadata");
  if (inconsistentLast.length) errors.push("last same-event flags are inconsistent");
  if (sourceHashMismatch.length) errors.push("canonical events are not bound to exact source SHA-256");
  if ((raw.validationErrors || []).length) errors.push(`raw parser validation errors: ${raw.validationErrors.join("; ")}`);

  return {
    errors,
    stats: {
      reviewedPatterns: raw.patterns?.length ?? 0,
      events: processed.events.length,
      lectures: lectureEvents.length,
      nonLectures: otherEvents.length,
      uniqueDates: new Set(processed.events.map((event) => event.timing.date)).size,
      overlaps: overlapCount(processed.events),
      lastSameEvents: processed.events.filter((event) => event.derived.is_last_same_event).length,
      serviceSignatures: serviceSignatures.length,
      sourceHashMismatch: sourceHashMismatch.length,
    },
  };
}

const inputPath = readArg("input");
const outputDir = readArg("output", "data/imports/ugmu-pilot/canonical");
if (!inputPath) throw new Error("--input is required");

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const canonical = canonicalizeUgmuWeeklyPilot(raw);
const inputQa = validateScheduleBatch(canonical);
const processed = postprocessSchedule(canonical, {
  includeServiceSignature: false,
  longBreakDays: 14,
});
const outputQa = validatePostprocessedSchedule(processed);
const custom = customQa(raw, canonical, processed);
const qaApproved = inputQa.publishable && outputQa.publishable && custom.errors.length === 0;
const report = {
  version: 1,
  university: "ugmu",
  group: "ОЛД 101",
  sourceSha256: raw.sources?.[0]?.sha256 || null,
  sourceSemanticReview: raw.sourceReview?.status || null,
  canonicalSchema: canonical.schema_version,
  inputQa,
  outputQa,
  customQa: custom,
  qaApproved,
  publicationAllowed: false,
  nextGate: qaApproved ? "versioning-and-stable-event-identity" : "fix-pilot-qa",
};

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "OLD-101.canonical.json"), `${JSON.stringify(canonical, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "OLD-101.postprocessed.json"), `${JSON.stringify(processed, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, "OLD-101.qa.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

console.log(`UGMU OLD 101 canonical events: ${processed.events.length}`);
console.log(`Input QA: ${inputQa.publishable ? "PASS" : "FAIL"}`);
console.log(`Postprocess QA: ${outputQa.publishable ? "PASS" : "FAIL"}`);
console.log(`Custom QA: ${custom.errors.length ? "FAIL" : "PASS"}`);
console.log(`QA approved: ${qaApproved ? "yes" : "no"}`);
console.log(`Publication allowed: no`);
if (!qaApproved) {
  for (const error of [...inputQa.errors, ...outputQa.errors, ...custom.errors]) {
    console.error(typeof error === "string" ? error : `${error.code}: ${error.message}`);
  }
  process.exitCode = 2;
}
