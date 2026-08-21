import fs from "node:fs/promises";
import path from "node:path";

import { buildUgmuPilotPublicationPackage } from "../src/adapters/ugmu/publication-package.mjs";

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const inputPath = readArg("input");
const outputDir = path.resolve(readArg("output", "data/imports/ugmu-pilot/package"));
if (!inputPath) throw new Error("--input is required");

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const pkg = buildUgmuPilotPublicationPackage(raw);
const schedulePath = path.join(outputDir, pkg.files.schedule);

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.dirname(schedulePath), { recursive: true });
await Promise.all([
  fs.writeFile(schedulePath, `${JSON.stringify(pkg.batch, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(outputDir, pkg.files.ics), pkg.ics, "utf8"),
  fs.writeFile(path.join(outputDir, pkg.files.current), `${JSON.stringify(pkg.current, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(outputDir, pkg.files.catalog), `${JSON.stringify(pkg.catalog, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(outputDir, pkg.files.report), `${JSON.stringify(pkg.report, null, 2)}\n`, "utf8"),
]);

console.log(`UGMU OLD 101 production-like package: ${pkg.report.failClosed && pkg.report.inputQa && pkg.report.outputQa ? "PASS" : "FAIL"}`);
console.log(`Schedule version: ${pkg.report.scheduleVersionId}`);
console.log(`Events: ${pkg.report.eventCount}`);
console.log(`ICS bytes: ${pkg.report.icsBytes}`);
console.log(`Fail-closed: ${pkg.report.failClosed ? "yes" : "no"}`);
console.log(`Publication allowed: ${pkg.report.publicationAllowed ? "yes" : "no"}`);
console.log(`Package: ${outputDir}`);

if (!pkg.report.inputQa || !pkg.report.outputQa || !pkg.report.currentPointerValid || !pkg.report.catalogPointerValid || !pkg.report.failClosed) {
  process.exitCode = 2;
}
