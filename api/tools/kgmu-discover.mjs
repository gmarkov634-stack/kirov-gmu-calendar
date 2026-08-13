import { discoverKgmuSources } from "../src/adapters/kgmu/discover.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const output = readArg("output", "data/imports/kgmu-source-manifest.json");
const manifest = await discoverKgmuSources({ output });

console.log(`Discovered ${manifest.sourceCount} KGMU XLSX schedule files`);
for (const page of manifest.pages) {
  console.log(`${page.status === "ok" ? "OK" : "FAIL"} ${page.label}: ${page.sourceCount}`);
}
console.log(`Manifest: ${output}`);
if (manifest.validation.errors.length) {
  console.error(manifest.validation.errors.join("\n"));
  process.exitCode = 2;
}
