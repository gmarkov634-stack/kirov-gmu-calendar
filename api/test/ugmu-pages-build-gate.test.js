import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync("../.github/workflows/omgmu-pages.yml", "utf8");

function stepBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(new RegExp(`      - name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - name:|\\n  deploy:|$)`));
  assert.ok(match, `workflow step is missing: ${name}`);
  return match[0];
}

test("shared Pages workflow is synchronized with the post-launch main authority", () => {
  assert.match(workflow, /concurrency:\n  group: medical-calendar-pages\n  cancel-in-progress: false/);
  assert.match(workflow, /UGMU_LAUNCH_SOURCE_SHA: 11c37ac0a6513c6621c297aec5c6dbceb42ede3b/);

  const checkout = stepBlock("Checkout exact UGMU launch source");
  assert.match(checkout, /ref: \$\{\{ env\.UGMU_LAUNCH_SOURCE_SHA \}\}/);
  assert.match(checkout, /path: ugmu-feature/);
});

test("pull requests validate the pinned UGMU source but cannot publish Pages", () => {
  const prepare = stepBlock("Prepare production artifact");
  assert.match(prepare, /if:\s*github\.event_name != 'pull_request'/);

  const pagesArtifact = stepBlock("Upload Pages artifact");
  assert.match(pagesArtifact, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(pagesArtifact, /uses:\s*actions\/upload-pages-artifact@v3/);

  assert.match(workflow, /deploy:\n    if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /uses:\s*actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /Upload PR Pages build evidence/);
});

test("production artifact always preserves the launched UGMU landing", () => {
  const prepare = stepBlock("Prepare production artifact");
  for (const marker of [
    "cp -R ugmu-feature/site/ugmu/. dist/site/ugmu/",
    "'name=\"robots\" content=\"noindex,follow\"':'name=\"robots\" content=\"index,follow\"'",
    "'Предзапусковый режим':'Календарь доступен'",
    "assert 'runtime.sales === \"open\"' in app",
    "assert 'runtime.paymentMode === \"live\"' in app",
    "assert '/api/v2/catalog/ugmu' not in app and '/api/v2/schedules/ugmu' not in app",
    "grep -q 'name=\"robots\" content=\"index,follow\"' dist/site/ugmu/index.html",
    "grep -q 'Календарь доступен' dist/site/ugmu/index.html",
  ]) assert.ok(prepare.includes(marker), `post-launch UGMU Pages marker missing: ${marker}`);
});

test("post-deploy verification requires all three public landing paths", () => {
  const verify = stepBlock("Verify all production landing paths");
  assert.match(verify, /kirov-gmu-calendar\/\?shared=/);
  assert.match(verify, /kirov-gmu-calendar\/omgmu\/\?shared=/);
  assert.match(verify, /kirov-gmu-calendar\/ugmu\/\?shared=/);
  assert.match(verify, /name=\"robots\" content=\"index,follow\"/);
  assert.match(verify, /Календарь доступен/);
});
