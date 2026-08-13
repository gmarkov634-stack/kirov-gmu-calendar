import fs from "node:fs/promises";
import path from "node:path";
import { buildKgmuQualityReport } from "../src/adapters/kgmu/quality.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const weeklyPath = readArg("weekly", "data/imports/kgmu-weekly-event-report.json");
const calendarPath = readArg("calendar", "data/imports/kgmu-calendar-grid-report.json");
const downloadPath = readArg("download", "data/imports/kgmu-official-reference-xlsx/download-report.json");
const outputPath = readArg("output", "data/imports/kgmu-quality-report.json");
const academicYear = readArg("academic-year", "2026/2027");
const semester = Number(readArg("semester", "1"));

const [weeklyReport, calendarReport, downloadReport] = await Promise.all([
  readJson(weeklyPath),
  readJson(calendarPath),
  readJson(downloadPath),
]);

const report = buildKgmuQualityReport({
  weeklyReport,
  calendarReport,
  downloadReport,
  academicYear,
  semester,
});

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`KGMU quality: ${report.status}`);
console.log(`Expected: ${report.expectedAcademicYear}, semester ${report.expectedSemester}`);
console.log(`Target groups: ${report.targetGroupCount}; ready: ${report.readyGroupCount}; blocked: ${report.blockedGroupCount}`);
console.log(`Archive/reference groups: ${report.archiveReferenceGroupCount}`);
console.log(`Report: ${outputPath}`);
