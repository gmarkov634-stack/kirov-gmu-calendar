#!/usr/bin/env node
import fs from "node:fs";
import { legacyReviewedBundleToCanonicalPackage } from "../src/adapters/kgmu/legacy-to-canonical.mjs";

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key || "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

const options = args(process.argv);
const groups = options.groups || options.group;
if (!options.input || !groups || !options["week1-start"] || !options.output) {
  throw new Error("Usage: --input FILE (--group GROUP | --groups all|GROUP,GROUP) --week1-start YYYY-MM-DD --output FILE");
}
const input = JSON.parse(fs.readFileSync(options.input, "utf8"));
const pkg = legacyReviewedBundleToCanonicalPackage(input, {
  groups,
  week1StartDate: options["week1-start"],
});
fs.writeFileSync(options.output, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(JSON.stringify({
  format: pkg.format,
  groupCount: pkg.batches.length,
  groups: pkg.batches.map((batch) => batch.schedule.group),
  eventCount: pkg.batches.reduce((sum, batch) => sum + batch.events.length, 0),
  output: options.output,
}));
