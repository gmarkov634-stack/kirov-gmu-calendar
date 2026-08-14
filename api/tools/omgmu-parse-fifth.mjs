import fs from "node:fs/promises";
import path from "node:path";
import { buildFifthCourseSchedule } from "../src/adapters/omgmu/cycle-parser.mjs";
import { assertOmgmuSourceProfile, OMG_SOURCE_PROFILES } from "../src/adapters/omgmu/source-profiles.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const input = path.resolve(readArg("input", "data/imports/omgmu-text/08_medicine-international_course-5_combined.txt"));
const output = path.resolve(readArg("output", "data/imports/omgmu-schedules/585.json"));
const sourceUrl = readArg("source", "");
const text = await fs.readFile(input, "utf8");
assertOmgmuSourceProfile(text, OMG_SOURCE_PROFILES.COMBINED_ROTATION_TABLE, { filename: path.basename(input) });
const schedule = buildFifthCourseSchedule(text, { sourceUrl: sourceUrl || null });
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
console.log(`Parsed ${schedule.events.length} events for ОмГМУ group ${schedule.group.code}`);
console.log(`Schedule: ${output}`);
if (!schedule.events.length) process.exitCode = 2;
