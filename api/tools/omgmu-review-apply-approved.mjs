import fs from "node:fs/promises";
import path from "node:path";
import {
  applyApprovedDecision,
  sourceSha256,
} from "../src/adapters/omgmu/manual-review.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const approvalsPath = path.resolve(arg("approvals", "../universities/omgmu/approved-reviews.json"));
const pdfDir = path.resolve(arg("pdf-dir", "data/imports/omgmu-pdfs"));
const scheduleDir = path.resolve(arg("schedule-dir", "data/imports/omgmu-schedules"));
const reportPath = path.resolve(arg("report", "data/imports/omgmu-approved-review-report.json"));

const registry = JSON.parse(await fs.readFile(approvalsPath, "utf8"));
if (registry.version !== 1 || registry.university !== "omgmu" || registry.status !== "approved") {
  throw new Error("Unsupported approved review registry");
}
if (!registry.userConfirmation || !registry.confirmedAt || Number.isNaN(Date.parse(registry.confirmedAt))) {
  throw new Error("Approved review registry is missing user confirmation metadata");
}
if (!Array.isArray(registry.approvals) || registry.approvals.length === 0) {
  throw new Error("Approved review registry is empty");
}

const seen = new Set();
const applied = [];
for (const approval of registry.approvals) {
  const group = String(approval?.group || "");
  if (!/^\d{3,4}$/.test(group)) throw new Error(`Invalid approval group: ${group}`);
  if (seen.has(group)) throw new Error(`Duplicate approval group: ${group}`);
  seen.add(group);
  if (!approval?.sourceFile || path.basename(approval.sourceFile) !== approval.sourceFile) {
    throw new Error(`Unsafe source file for group ${group}`);
  }

  const sourcePath = path.join(pdfDir, approval.sourceFile);
  const schedulePath = path.join(scheduleDir, `${group}.json`);
  const [source, scheduleText] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(schedulePath, "utf8"),
  ]);
  const schedule = JSON.parse(scheduleText);
  const approved = applyApprovedDecision(schedule, approval, {
    sourceHash: sourceSha256(source),
    userConfirmation: registry.userConfirmation,
    confirmedAt: registry.confirmedAt,
  });
  await fs.writeFile(schedulePath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
  applied.push({
    group,
    sourceFile: approval.sourceFile,
    sourceSha256: approval.sourceSha256,
    eventsSha256: approval.eventsSha256,
    eventCount: approved.events.length,
    reviewedBy: approval.reviewedBy,
    reviewedAt: approval.reviewedAt,
    confirmedAt: registry.confirmedAt,
  });
}

const report = {
  version: 1,
  university: "omgmu",
  status: "applied",
  generatedAt: new Date().toISOString(),
  userConfirmation: registry.userConfirmation,
  confirmedAt: registry.confirmedAt,
  applied,
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Applied approved manual reviews: ${applied.map((item) => item.group).join(", ")}`);
console.log(`Report: ${reportPath}`);
