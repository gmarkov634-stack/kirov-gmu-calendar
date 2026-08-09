import fs from "node:fs/promises";
import path from "node:path";
import { sourceSha256 } from "../src/adapters/omgmu/manual-review.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const group = arg("group");
const sourcePath = arg("source");
const schedulePath = arg("schedule");
const outputPath = arg("output", group ? `data/manual-review/${group}.review.json` : null);

if (!group || !sourcePath || !schedulePath || !outputPath) {
  console.error("Usage: npm run review:omgmu:prepare -- --group=2108 --source=source.pdf --schedule=2108.json --output=2108.review.json");
  process.exit(2);
}

const [source, scheduleText] = await Promise.all([
  fs.readFile(path.resolve(sourcePath)),
  fs.readFile(path.resolve(schedulePath), "utf8"),
]);
const schedule = JSON.parse(scheduleText);
if (String(schedule?.group?.code) !== String(group)) {
  throw new Error(`Schedule group ${schedule?.group?.code || "unknown"} does not match ${group}`);
}

const draft = {
  version: 1,
  group: String(group),
  status: "pending",
  sourceSha256: sourceSha256(source),
  sourceFile: path.basename(sourcePath),
  reviewedBy: "",
  reviewedAt: "",
  events: Array.isArray(schedule.events) ? schedule.events.map(({ title, start, end, location = "" }) => ({ title, start, end, location })) : [],
};

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(`Manual review draft created for group ${group}`);
console.log(`Source SHA-256: ${draft.sourceSha256}`);
console.log(`Output: ${path.resolve(outputPath)}`);
