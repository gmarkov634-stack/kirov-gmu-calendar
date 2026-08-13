#!/usr/bin/env node
import fs from "node:fs";
import { legacyReviewedGroupToCanonicalPackage } from "../src/adapters/kgmu/legacy-to-canonical.mjs";

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
if (!options.input || !options.group || !options["week1-start"] || !options.output) {
  throw new Error("Usage: --input FILE --group GROUP --week1-start YYYY-MM-DD --output FILE");
}
const input = JSON.parse(fs.readFileSync(options.input, "utf8"));
const pkg = legacyReviewedGroupToCanonicalPackage(input, {
  group: options.group,
  week1StartDate: options["week1-start"],
});
fs.writeFileSync(options.output, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(JSON.stringify({
  format: pkg.format,
  group: pkg.batches[0].schedule.group,
  eventCount: pkg.batches[0].events.length,
  period: pkg.batches[0].schedule.period,
  output: options.output,
}));
