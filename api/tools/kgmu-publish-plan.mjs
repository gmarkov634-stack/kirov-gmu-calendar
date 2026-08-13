import fs from "node:fs/promises";
import path from "node:path";
import { buildKgmuPublicationPlan } from "../src/adapters/kgmu/publish.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function readSchedules(directory) {
  const absolute = path.resolve(directory);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const schedules = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "summary.json") continue;
    const value = JSON.parse(await fs.readFile(path.join(absolute, entry.name), "utf8"));
    if (value?.university === "kgmu" && value?.group?.code) schedules.push(value);
  }
  return schedules;
}

const schedulesDir = readArg("schedules", "data/imports/kgmu-normalized-schedules");
const outputPath = readArg("output", "data/imports/kgmu-publication-plan.json");

const schedules = await readSchedules(schedulesDir);
const plan = buildKgmuPublicationPlan(schedules);
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

console.log("KGMU publication plan: DRY RUN ONLY");
console.log(`Normalized schedules: ${schedules.length}`);
console.log(`Publishable groups: ${plan.publishable.length}`);
console.log(`Blocked groups: ${plan.blocked.length}`);
console.log(`Plan: ${outputPath}`);
