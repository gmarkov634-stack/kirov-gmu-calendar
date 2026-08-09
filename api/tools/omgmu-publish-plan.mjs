import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicationPlan } from "../src/adapters/omgmu/publish.mjs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const inputDir = path.resolve(arg("input", "data/imports/omgmu-schedules"));
const outputDir = path.resolve(arg("output", "data/publication/omgmu"));
const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const schedules = [];
for (const file of files) schedules.push(JSON.parse(await fs.readFile(path.join(inputDir, file), "utf8")));

const plan = buildPublicationPlan(schedules);
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "objects"), { recursive: true });

const manifest = {
  version: plan.version,
  university: plan.university,
  generatedAt: plan.generatedAt,
  publishableCount: plan.publishable.length,
  blockedCount: plan.blocked.length,
  objects: [],
  blocked: plan.blocked.map(({ group, reason }) => ({ group, reason })),
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
