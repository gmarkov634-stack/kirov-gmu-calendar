import fs from "node:fs/promises";
import path from "node:path";
import { buildFourthCourseSchedules } from "../src/adapters/omgmu/fourth-parser.mjs";
import { assertOmgmuSourceProfile, OMG_SOURCE_PROFILES } from "../src/adapters/omgmu/source-profiles.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const lecturesInput = path.resolve(readArg("lectures", "data/imports/omgmu-text/06_medicine-international_course-4_lectures.txt"));
const cyclesInput = path.resolve(readArg("cycles", "data/imports/omgmu-text/07_medicine-international_course-4_cycles.txt"));
const outputDir = path.resolve(readArg("output", "data/imports/omgmu-schedules"));
const [lecturesText, cyclesText] = await Promise.all([
  fs.readFile(lecturesInput, "utf8"),
  fs.readFile(cyclesInput, "utf8"),
]);
assertOmgmuSourceProfile(lecturesText, OMG_SOURCE_PROFILES.COURSE_LECTURE_LIST, { filename: path.basename(lecturesInput) });
assertOmgmuSourceProfile(cyclesText, OMG_SOURCE_PROFILES.CYCLE_ROTATION_GRID, { filename: path.basename(cyclesInput) });
const schedules = buildFourthCourseSchedules(lecturesText, cyclesText);
await fs.mkdir(outputDir, { recursive: true });
for (const [groupCode, schedule] of Object.entries(schedules)) {
  await fs.writeFile(path.join(outputDir, `${groupCode}.json`), `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
  console.log(`Parsed ${schedule.events.length} events for ОмГМУ group ${groupCode}`);
  if (!schedule.events.length) process.exitCode = 2;
}
