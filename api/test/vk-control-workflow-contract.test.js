import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("VK control workflow listens only to the temporary command file", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "vk-control.yml"), "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /ops\/vk\/command\.json/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /github\.actor == 'gmarkov634-stack'/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /kgmu-vk-control/);
});
