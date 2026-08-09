import fs from "node:fs/promises";
import path from "node:path";
import { applyApprovedReview, sourceSha256 } from "../src/adapters/omgmu/manual-review.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const sourcePath = arg("source");
const schedulePath = arg("schedule");
const reviewPath = arg("review");
const outputPath = arg("output");

if (!sourcePath || !schedulePath || !reviewPath || !outputPath) {
  console.error("Usage: npm run review:omgmu:apply -- --source=source.pdf --schedule=2108.json --review=2108.review.json --output=2108.approved.json");
  process.exit(2);
}

const [source, scheduleText, reviewText] = await Promise.all([
  fs.readFile(path.resolve(sourcePath)),
  fs.readFile(path.resolve(schedulePath), "utf8"),
  fs.readFile(path.resolve(reviewPath), "utf8"),
]);

const schedule = JSON.parse(scheduleText);
const review = JSON.parse(reviewText);
const approved = applyApprovedReview(schedule, review, { sourceHash: sourceSha256(source) });

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(approved, null, 2)}\n`, "utf8");
console.log(`Approved manual schedule written for group ${approved.group.code}`);
console.log(`Events: ${approved.events.length}`);
console.log(`Output: ${path.resolve(outputPath)}`);
