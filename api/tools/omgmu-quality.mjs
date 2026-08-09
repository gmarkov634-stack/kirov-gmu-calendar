import fs from "node:fs/promises";
import path from "node:path";
import { buildQualityReport } from "../src/adapters/omgmu/quality.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const inputDir = path.resolve(readArg("input", "data/imports/omgmu-schedules"));
const output = path.resolve(readArg("output", "data/imports/omgmu-quality-report.json"));
const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const schedules = [];
for (const file of files) {
  schedules.push(JSON.parse(await fs.readFile(path.join(inputDir, file), "utf8")));
}

const report = buildQualityReport(schedules);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Quality checked ${report.scheduleCount} schedules and ${report.eventCount} events`);
console.log(`Errors: ${report.errorCount}; warnings: ${report.warningCount}`);
for (const group of report.groups.filter((item) => item.errors.length || item.warnings.length)) {
  console.log(`${group.group}: ${group.errors.length} errors, ${group.warnings.length} warnings`);
}
console.log(`Report: ${output}`);
if (report.errorCount > 0) process.exitCode = 2;
