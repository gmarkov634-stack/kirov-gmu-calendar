import path from "node:path";
import { buildOmgmuCatalog } from "../src/adapters/omgmu/catalog.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const textDir = path.resolve(readArg("text-dir", "data/imports/omgmu-text"));
const output = path.resolve(readArg("output", "data/imports/omgmu-catalog.json"));
const catalog = await buildOmgmuCatalog({ textDir, output });

console.log(`Extracted ${catalog.groupCount} ОмГМУ groups`);
for (const offering of catalog.offerings) {
  console.log(`${offering.program} course ${offering.course}${offering.stream ? ` stream ${offering.stream}` : ""}: ${offering.groupCodes.join(", ") || "shared schedule"}`);
}
console.log(`Catalog: ${output}`);
