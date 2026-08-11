import fs from "node:fs/promises";
import path from "node:path";
import { buildKgmuPublicationPlan } from "../src/adapters/kgmu/publish.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

const qualityPath = readArg("quality", "data/imports/kgmu-2026-27-quality-report.json");
const weeklyPath = readArg("weekly", "data/imports/kgmu-2026-27-weekly-event-report.json");
const calendarPath = readArg("calendar", "data/imports/kgmu-2026-27-calendar-grid-report.json");
const outputPath = readArg("output", "data/imports/kgmu-publication-plan.json");

const [qualityReport, weeklyReport, calendarReport] = await Promise.all([
  readJson(qualityPath),
  readJson(weeklyPath),
  readJson(calendarPath),
]);

const plan = buildKgmuPublicationPlan({ qualityReport, weeklyReport, calendarReport });
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

console.log("KGMU publication plan: DRY RUN ONLY");
console.log(`Publishable groups: ${plan.publishable.length}`);
console.log(`Blocked groups: ${plan.blocked.length}`);
console.log(`Plan: ${outputPath}`);
