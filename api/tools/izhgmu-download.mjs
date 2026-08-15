import fs from "node:fs/promises";
import { downloadIzhgmuSources } from "../src/adapters/izhgmu/download.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/izhgmu-source-manifest.json");
const outputDir = readArg("output-dir", "data/imports/izhgmu");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const report = await downloadIzhgmuSources({ manifest, outputDir });

console.log(`Downloaded ${report.downloadedCount}/${report.sourceCount} IzhGMU XLSX files`);
console.log(`Report: ${outputDir}/download-report.json`);
if (report.failedCount) process.exitCode = 2;
