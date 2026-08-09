import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicationPlan } from "../src/adapters/omgmu/publish.mjs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function optionalCount(name) {
  const value = arg(name, null);
  if (value == null) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid --${name}: ${value}`);
  return count;
}

const inputDir = path.resolve(arg("input", "data/imports/omgmu-schedules"));
const outputDir = path.resolve(arg("output", "data/publication/omgmu"));
const expectedPublishable = optionalCount("expected-publishable");
const expectedBlocked = optionalCount("expected-blocked");
const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const schedules = [];
for (const file of files) schedules.push(JSON.parse(await fs.readFile(path.join(inputDir, file), "utf8")));

const plan = buildPublicationPlan(schedules);
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "objects"), { recursive: true });

const blocked = plan.blocked.map(({ group, reason, key }) => {
  if (!key) throw new Error(`Blocked schedule ${group || "unknown"} is missing its storage key`);
  return { group, reason, key };
});

const manifest = {
  version: plan.version,
  university: plan.university,
  generatedAt: plan.generatedAt,
  publishableCount: plan.publishable.length,
  blockedCount: plan.blocked.length,
  objects: [],
  blocked,
};

for (const entry of plan.publishable) {
  const relative = path.join("objects", `${entry.group}.json`);
  await fs.writeFile(path.join(outputDir, relative), `${JSON.stringify(entry.schedule, null, 2)}\n`, "utf8");
  manifest.objects.push({ group: entry.group, key: entry.key, file: relative.replaceAll(path.sep, "/") });
}

await fs.writeFile(path.join(outputDir, "publication-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Publishable: ${manifest.publishableCount}; blocked: ${manifest.blockedCount}`);
for (const item of manifest.blocked) console.log(`Blocked ${item.group}: ${item.reason}`);
console.log(`Publication package: ${outputDir}`);

const mismatches = [];
if (expectedPublishable != null && manifest.publishableCount !== expectedPublishable) {
  mismatches.push(`publishable expected ${expectedPublishable}, got ${manifest.publishableCount}`);
}
if (expectedBlocked != null && manifest.blockedCount !== expectedBlocked) {
  mismatches.push(`blocked expected ${expectedBlocked}, got ${manifest.blockedCount}`);
}
if (mismatches.length) {
  throw new Error(`Publication count mismatch: ${mismatches.join("; ")}`);
}
