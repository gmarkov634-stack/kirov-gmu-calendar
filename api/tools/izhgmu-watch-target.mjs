import fs from "node:fs/promises";
import path from "node:path";
import { discoverIzhgmuSources, IZH_GMU_SOURCE } from "../src/adapters/izhgmu/discover.mjs";
import { downloadIzhgmuSources } from "../src/adapters/izhgmu/download.mjs";
import {
  IZHGMU_LAUNCH_TARGET,
  selectIzhgmuLaunchTargetSources,
  summarizeIzhgmuLaunchTarget,
} from "../src/adapters/izhgmu/target-watch.mjs";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outputDir = path.resolve(argValue("--output", "data/izhgmu/target-watch"));
const sourceUrl = argValue("--source", IZH_GMU_SOURCE);
const concurrency = Number(argValue("--concurrency", "4"));
await fs.mkdir(outputDir, { recursive: true });

const manifest = await discoverIzhgmuSources({
  sourceUrl,
  output: path.join(outputDir, "source-manifest.json"),
});
const targetSources = selectIzhgmuLaunchTargetSources(manifest.sources, IZHGMU_LAUNCH_TARGET);

let downloadReport = null;
if (targetSources.length) {
  const targetManifest = {
    ...manifest,
    sourceCount: targetSources.length,
    sources: targetSources,
  };
  downloadReport = await downloadIzhgmuSources({
    manifest: targetManifest,
    outputDir: path.join(outputDir, "sources"),
    concurrency,
  });
}

const report = summarizeIzhgmuLaunchTarget({ manifest, downloadReport });
await fs.writeFile(
  path.join(outputDir, "target-watch-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log("IZHGMU_TARGET_WATCH", JSON.stringify({
  status: report.status,
  candidateSourceCount: report.candidateSourceCount,
  downloadedCount: report.downloadedCount,
  failedCount: report.failedCount,
  sourceSetDigest: report.sourceSetDigest,
  pageScheduleContext: report.pageScheduleContext,
  target: report.target,
}));

// Detection never parses or publishes. A candidate with failed downloads is a
// review condition and is surfaced to the workflow for notification/failure.
if (report.status === "review-required") process.exitCode = 2;
