import { discoverUgmuSources } from "../src/adapters/ugmu/discover.mjs";
import { getUgmuSourcePage } from "../src/adapters/ugmu/source-registry.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const program = readArg("program", "medicine");
const source = readArg("source", getUgmuSourcePage(program)?.page || "");
const output = readArg("output", `data/imports/ugmu-${program}-source-manifest.json`);

const manifest = await discoverUgmuSources({
  program,
  sourceUrl: source || undefined,
  output,
});

console.log(`Discovered ${manifest.sourceCount} UGMU schedule files for ${program}`);
console.log(`Manifest: ${output}`);
console.log(`Validation: ${manifest.validation.status}`);
if (manifest.validation.errors.length) {
  console.error(manifest.validation.errors.join("\n"));
  process.exitCode = 2;
}
