import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const repoFile = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const parityFiles = ["app.js", "config.js", "index.html", "ugmu.css"];

for (const file of parityFiles) {
  test(`UGMU controlled Pages source matches canonical landing: ${file}`, () => {
    assert.equal(repoFile(`site/ugmu/${file}`), repoFile(`ugmu/${file}`));
  });
}

test("controlled Pages v2 deploy verifies dedicated trial UX without opening the gate", () => {
  const workflow = repoFile(".github/workflows/ugmu-controlled-pages-main-v2.yml");
  assert.match(workflow, /INITIAL_SOURCE_SHA: f7e91a76f489bc9d8994880bcae2ac7d6f6a48f9/);
  assert.match(workflow, /id=\\"trial-start\\"/);
  assert.match(workflow, /meta\.universityTrials\?\.ugmu === \\"open\\"/);
  assert.match(workflow, /Пробный доступ пока закрыт/);
  assert.match(workflow, /UGMU_PAGES_DEPLOY_SAFE mode=\$MODE trial_ui=true/);
  assert.doesNotMatch(workflow, /UGMU_TRIALS_ENABLED[^\n]*true/);
});
