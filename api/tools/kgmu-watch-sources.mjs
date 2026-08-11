import fs from "node:fs/promises";
import path from "node:path";
import { buildKgmuSourceWatchReport } from "../src/adapters/kgmu/watch.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/kgmu-source-manifest.json");
const configPath = readArg("config", "../universities/kgmu/source-watch.json");
const outputPath = readArg("output", "data/imports/kgmu-source-watch-report.json");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const report = buildKgmuSourceWatchReport(manifest, config);

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`KGMU source watch: ${report.status}`);
console.log(`Expected: ${report.expectedAcademicYear}, semester ${report.expectedSemester}`);
console.log(`Target XLSX files: ${report.targetSourceCount}; groups: ${report.targetGroupCount}`);
for (const program of report.targetPrograms) {
  console.log(`${program.available ? "READY" : "WAIT"} ${program.label}: ${program.sourceCount} source(s), ${program.groupCount} group(s)`);
}
console.log(`Report: ${outputPath}`);
