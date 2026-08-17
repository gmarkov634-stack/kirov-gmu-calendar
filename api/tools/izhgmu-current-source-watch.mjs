import fs from "node:fs/promises";
import path from "node:path";
import { summarizeIzhgmuLaunchTarget } from "../src/adapters/izhgmu/target-watch.mjs";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const inputDir = path.resolve(argValue("--input-dir", "data/izhgmu/current"));
const output = path.resolve(argValue("--output", path.join(inputDir, "current-target-report.json")));
const manifest = JSON.parse(await fs.readFile(path.join(inputDir, "source-manifest.json"), "utf8"));
let downloadReport = null;
try {
  downloadReport = JSON.parse(await fs.readFile(path.join(inputDir, "download-report.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const report = summarizeIzhgmuLaunchTarget({ manifest, downloadReport });
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

console.log("IZHGMU_CURRENT_SOURCE", JSON.stringify({
  status: report.status,
  academicYear: report.target.academicYear,
  term: report.target.term,
  sourceCount: report.candidateSourceCount,
  downloadedCount: report.downloadedCount,
  failedCount: report.failedCount,
  sourceSetDigest: report.sourceSetDigest,
}));

// Waiting for the exact period is a healthy observation state. A source set that
// appears but cannot be downloaded completely is review-required, not publishable.
if (report.status === "review-required") process.exitCode = 2;
