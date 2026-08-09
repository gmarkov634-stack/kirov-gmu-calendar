import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { applyApprovedReview, sourceSha256 } from "../src/adapters/omgmu/manual-review.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function canonicalEvents(schedule) {
  return (schedule?.events || []).map(({ title, start, end, location = "" }) => ({
    title,
    start,
    end,
    location,
  }));
}

function eventsSha256(events) {
  return crypto.createHash("sha256").update(JSON.stringify(events)).digest("hex");
}

const registryPath = path.resolve(arg("registry", "../universities/omgmu/manual-review.json"));
const sourceDir = path.resolve(arg("source-dir", "data/imports/omgmu-pdfs"));
const scheduleDir = path.resolve(arg("schedule-dir", "data/imports/omgmu-schedules"));
const reportPath = path.resolve(arg("report", "data/imports/omgmu-manual-review-application.json"));

const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
if (registry.version !== 2 || registry.university !== "omgmu" || !Array.isArray(registry.groups)) {
  throw new Error("Unsupported ОмГМУ manual review registry");
}

const approvedEntries = registry.groups.filter((entry) => entry.status === "approved");
const report = {
  version: 1,
  university: "omgmu",
  registry: path.relative(process.cwd(), registryPath),
  applied: [],
};

for (const entry of approvedEntries) {
  const group = String(entry.group || "");
  if (!group || !entry.sourceFile || !entry.sourceSha256 || !entry.eventsSha256) {
    throw new Error(`Incomplete approved review metadata for group ${group || "unknown"}`);
  }

  const schedulePath = path.join(scheduleDir, `${group}.json`);
  const sourcePath = path.join(sourceDir, entry.sourceFile);
  const [scheduleText, source] = await Promise.all([
    fs.readFile(schedulePath, "utf8"),
    fs.readFile(sourcePath),
  ]);
  const schedule = JSON.parse(scheduleText);
  if (String(schedule?.group?.code || "") !== group) {
    throw new Error(`Schedule group mismatch for ${group}`);
  }

  const actualSourceHash = sourceSha256(source);
  if (actualSourceHash !== entry.sourceSha256) {
    throw new Error(`Official PDF changed for group ${group}: ${actualSourceHash}`);
  }

  const events = canonicalEvents(schedule);
  const actualEventsHash = eventsSha256(events);
  if (events.length !== entry.eventCount) {
    throw new Error(`Event count changed for group ${group}: ${events.length}, expected ${entry.eventCount}`);
  }
  if (actualEventsHash !== entry.eventsSha256) {
    throw new Error(`Parsed events changed for group ${group}: ${actualEventsHash}`);
  }

  const resolvedImportWarnings = Array.isArray(schedule.importWarnings)
    ? schedule.importWarnings.map(String)
    : [];
  const review = {
    version: 1,
    group,
    status: "approved",
    sourceSha256: entry.sourceSha256,
    reviewedBy: entry.reviewedBy,
    reviewedAt: entry.reviewedAt,
    events,
  };
  const approved = applyApprovedReview(schedule, review, { sourceHash: actualSourceHash });
  approved.importWarnings = [];
  approved.review = {
    ...approved.review,
    eventsSha256: entry.eventsSha256,
    decision: entry.decision,
    resolvedImportWarnings,
    applicationConfirmedBy: registry.applicationConfirmedBy,
    applicationConfirmedOn: registry.applicationConfirmedOn,
  };
  await fs.writeFile(schedulePath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
  report.applied.push({
    group,
    sourceFile: entry.sourceFile,
    sourceSha256: actualSourceHash,
    eventsSha256: actualEventsHash,
    eventCount: events.length,
    resolvedImportWarningCount: resolvedImportWarnings.length,
  });
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Applied approved manual reviews: ${report.applied.map((item) => item.group).join(", ")}`);
console.log(`Report: ${reportPath}`);
