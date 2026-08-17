import path from "node:path";
import { discoverIzhgmuSources, IZH_GMU_SOURCE } from "../src/adapters/izhgmu/discover.mjs";
import { downloadIzhgmuSources } from "../src/adapters/izhgmu/download.mjs";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outputDir = path.resolve(argValue("--output", "data/izhgmu/current"));
const sourceUrl = argValue("--source", IZH_GMU_SOURCE);
const concurrency = Number(argValue("--concurrency", "4"));
const manifestPath = path.join(outputDir, "source-manifest.json");

const manifest = await discoverIzhgmuSources({ sourceUrl, output: manifestPath });
console.log("IZHGMU_DISCOVERY", JSON.stringify({
  sourceCount: manifest.sourceCount,
  validation: manifest.validation.status,
  warnings: manifest.validation.warnings.length,
  context: manifest.scheduleContext,
}));

if (manifest.validation.status !== "ok") {
  console.error("IZHGMU_DISCOVERY_REVIEW_REQUIRED", JSON.stringify(manifest.validation));
  process.exitCode = 2;
} else {
  const report = await downloadIzhgmuSources({ manifest, outputDir, concurrency });
  console.log("IZHGMU_DOWNLOAD", JSON.stringify({
    sourceCount: report.sourceCount,
    downloadedCount: report.downloadedCount,
    failedCount: report.failedCount,
  }));
  if (report.failedCount > 0) process.exitCode = 3;
}
