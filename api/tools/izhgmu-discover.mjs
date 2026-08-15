import { discoverIzhgmuSources, IZH_GMU_SOURCE } from "../src/adapters/izhgmu/discover.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const sourceUrl = readArg("source", IZH_GMU_SOURCE);
const output = readArg("output", "data/imports/izhgmu-source-manifest.json");
const manifest = await discoverIzhgmuSources({ sourceUrl, output });

console.log(`Discovered ${manifest.sourceCount} IzhGMU schedule files`);
console.log(`Manifest: ${output}`);
for (const warning of manifest.validation.warnings || []) console.warn(warning);
if (manifest.validation.errors.length) {
  console.error(manifest.validation.errors.join("\n"));
  process.exitCode = 2;
}
