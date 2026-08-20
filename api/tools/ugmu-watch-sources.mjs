import fs from "node:fs/promises";
import path from "node:path";

import { buildUgmuSourceWatchReport } from "../src/adapters/ugmu/watch.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/ugmu-source-manifest.json");
const downloadPath = readArg("download", "data/imports/ugmu-watched-pdfs/download-report.json");
const configPath = readArg("config", "../universities/ugmu/source-watch.json");
const previousPath = readArg("previous", "");
const outputPath = readArg("output", "data/imports/ugmu-source-watch-report.json");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const downloadReport = JSON.parse(await fs.readFile(downloadPath, "utf8"));
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
let previousVersions = null;
if (previousPath) previousVersions = JSON.parse(await fs.readFile(previousPath, "utf8"));

const report = buildUgmuSourceWatchReport(manifest, downloadReport, config, previousVersions);
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`UGMU source watch: ${report.status}`);
console.log(`Candidates: ${report.candidateCount}; failed: ${report.failedCount}; unresolved: ${report.unresolvedCount}`);
console.log(`Changed/new against baseline: ${report.changeCount}`);
console.log(`Publication allowed: ${report.publicationAllowed ? "yes" : "no"}`);
console.log(`Report: ${outputPath}`);
if (report.failedCount || report.unresolvedCount) process.exitCode = 2;
