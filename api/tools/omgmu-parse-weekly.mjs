import fs from "node:fs/promises";
import path from "node:path";
import { buildWeeklySchedules } from "../src/adapters/omgmu/weekly-parser-blocks.mjs";
import { assertOmgmuSourceProfile, OMG_SOURCE_PROFILES } from "../src/adapters/omgmu/source-profiles.mjs";
import { readOmgmuSourceText } from "../src/adapters/omgmu/text-input.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const input = path.resolve(readArg("input", "data/imports/omgmu-text/01_medicine-international_course-1_stream-1_combined.txt"));
const outputDir = path.resolve(readArg("output", "data/imports/omgmu-schedules"));
const course = Number(readArg("course", "1"));
const stream = readArg("stream", "") || null;
const sourceUrl = readArg("source", "") || null;
const text = await readOmgmuSourceText(input);
assertOmgmuSourceProfile(text, OMG_SOURCE_PROFILES.WEEKLY_GRID, { filename: path.basename(input) });
const schedules = buildWeeklySchedules(text, { course, stream, sourceUrl });
await fs.mkdir(outputDir, { recursive: true });
let eventCount = 0;
for (const schedule of schedules) {
  await fs.writeFile(path.join(outputDir, `${schedule.group.code}.json`), `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
  eventCount += schedule.events.length;
}
console.log(`Parsed ${eventCount} events for ${schedules.length} ОмГМУ groups`);
if (!schedules.length || !eventCount) process.exitCode = 2;
