import fs from "node:fs/promises";
import { downloadUgmuSources } from "../src/adapters/ugmu/download.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/ugmu-source-manifest.json");
const outputDir = readArg("output", "data/imports/ugmu-pdfs");
const semester = readArg("semester", "autumn");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const report = await downloadUgmuSources({ manifest, outputDir, semester });

console.log(`Downloaded ${report.downloadedCount}/${report.sourceCount} UGMU PDF files`);
console.log(`Report: ${outputDir}/download-report.json`);
if (report.failedCount) process.exitCode = 2;
