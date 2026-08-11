import fs from "node:fs/promises";
import { downloadKgmuSources } from "../src/adapters/kgmu/download.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/kgmu-source-manifest.json");
const outputDir = readArg("output", "data/imports/kgmu-xlsx");
const academicYear = readArg("academic-year", "2026/2027");
const semester = Number(readArg("semester", "1"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const report = await downloadKgmuSources({ manifest, outputDir, academicYear, semester });

console.log(`Downloaded ${report.downloadedCount}/${report.sourceCount} KGMU XLSX files`);
console.log(`Report: ${outputDir}/download-report.json`);
if (report.failedCount) process.exitCode = 2;
