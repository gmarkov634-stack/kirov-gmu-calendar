import fs from "node:fs/promises";
import path from "node:path";
import { validateKgmuVerifiedImport } from "../src/adapters/kgmu/verified-import.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const input = arg("input");
const output = arg("output", "data/imports/kgmu-verified-schedules");
const summaryPath = arg("summary", "data/imports/kgmu-verified-import-summary.json");
const academicYear = arg("academic-year");
const semester = arg("semester");

if (!input) throw new Error("--input is required");
if (!academicYear || !semester) throw new Error("--academic-year and --semester are required");

const bundle = JSON.parse(await fs.readFile(path.resolve(input), "utf8"));
const result = validateKgmuVerifiedImport(bundle, { academicYear, semester: Number(semester) });
const outputDir = path.resolve(output);
await fs.mkdir(outputDir, { recursive: true });

for (const schedule of result.schedules) {
  const filename = `${schedule.program}-course-${schedule.course}-group-${schedule.group.code}.json`;
  await fs.writeFile(path.join(outputDir, filename), `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
}

const summary = {
  version: 1,
  university: "kgmu",
  academicYear: result.academicYear,
  semester: result.semester,
  approvedAt: result.approvedAt,
  reviewMethod: result.reviewMethod,
  sourceFileCount: result.sourceFileCount,
  scheduleCount: result.scheduleCount,
  outputDir: output,
};
await fs.mkdir(path.dirname(path.resolve(summaryPath)), { recursive: true });
await fs.writeFile(path.resolve(summaryPath), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log("KGMU verified import accepted");
console.log(`Academic year: ${result.academicYear}; semester: ${result.semester}`);
console.log(`Official XLSX files: ${result.sourceFileCount}`);
console.log(`Schedules: ${result.scheduleCount}`);
console.log(`Output: ${output}`);
console.log("No S3 write was performed.");
