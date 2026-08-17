import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../../.github/workflows/omgmu-discovery.yml", import.meta.url), "utf8");

test("OmGMU discovery inventories all sources but isolates the legacy parser to medicine-international", () => {
  assert.match(workflow, /discover:omgmu -- --output=data\/imports\/omgmu-source-manifest\.json/);
  assert.match(workflow, /source\.program === 'medicine-international'/);
  assert.match(workflow, /Expected exactly 8 medicine-international legacy parser sources/);
  assert.match(workflow, /omgmu-parser-source-manifest\.json/);
  assert.match(workflow, /download:omgmu -- --manifest=data\/imports\/omgmu-parser-source-manifest\.json/);
  assert.doesNotMatch(workflow, /download:omgmu -- --manifest=data\/imports\/omgmu-source-manifest\.json/);
});
