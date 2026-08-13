import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function json(url) {
  return JSON.parse(fs.readFileSync(url, "utf8"));
}

test("API-packaged schedule schemas exactly match canonical repository schemas", () => {
  for (const name of ["schedule-batch.schema.json", "schedule-event.schema.json"]) {
    const canonical = json(new URL(`../../schemas/${name}`, import.meta.url));
    const packaged = json(new URL(`../schemas/${name}`, import.meta.url));
    assert.deepEqual(packaged, canonical, `${name} packaged copy drifted from canonical schema`);
  }
});

test("production Docker image explicitly includes packaged schemas", () => {
  const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /^COPY schemas \.\/schemas$/m);
});
