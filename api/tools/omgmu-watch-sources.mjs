import fs from "node:fs/promises";
import path from "node:path";
import { buildOmgmuSourceWatchReport } from "../src/adapters/omgmu/watch.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = readArg("manifest", "data/imports/omgmu-source-manifest.json");
const configPath = readArg("config", "../universities/omgmu/source-watch.json");
const outputPath = readArg("output", "data/imports/omgmu-source-watch-report.json");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const report = buildOmgmuSourceWatchReport(manifest, config);

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`ОмГМУ source watch: ${report.status}`);
console.log(`Official page: ${report.pageAcademicYear || "unknown year"}, ${report.pageSemester || "unknown semester"}`);
console.log(`New target programs with files: ${report.availableTargetCount}`);
for (const program of report.targetPrograms) {
  console.log(`${program.available ? "READY" : "WAIT"} ${program.label}: ${program.sourceCount} source(s)`);
}
console.log(`Report: ${outputPath}`);
