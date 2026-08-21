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

test("shared Pages workflow uses current main UGMU source without historical pinning", () => {
  assert.match(workflow, /concurrency:\n  group: medical-calendar-pages\n  cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /UGMU_LAUNCH_SOURCE_SHA/);
  assert.doesNotMatch(workflow, /ugmu-feature/);
  assert.match(workflow, /- "site\/ugmu\/\*\*"/);
  assert.match(workflow, /- "ugmu\/\*\*"/);
});

test("pull requests validate UGMU source/root sync but cannot publish Pages", () => {
  const validate = stepBlock("Validate landing files and live commercial boundary");
  assert.match(validate, /cmp -s "site\/ugmu\/\$file" "ugmu\/\$file"/);
  assert.match(validate, /UGMU canonical source drift/);
  assert.match(validate, /UGMU site source and root launch copy must be identical/);

  const prepare = stepBlock("Prepare production artifact");
  assert.match(prepare, /if:\s*github\.event_name != 'pull_request'/);

  const pagesArtifact = stepBlock("Upload Pages artifact");
  assert.match(pagesArtifact, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(pagesArtifact, /uses:\s*actions\/upload-pages-artifact@v3/);

  assert.match(workflow, /deploy:\n    if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /uses:\s*actions\/deploy-pages@v4/);
});

test("production artifact uses the canonical launched UGMU source directly", () => {
  const prepare = stepBlock("Prepare production artifact");
  for (const marker of [
    "cp -R site/ugmu/. dist/site/ugmu/",
    "assert 'runtime.sales === \"open\"' in app",
    "assert 'runtime.paymentMode === \"live\"' in app",
    "assert '/api/v2/catalog/ugmu' not in app and '/api/v2/schedules/ugmu' not in app",
    "assert 'name=\"robots\" content=\"index,follow\"' in h",
    "assert 'Календарь доступен' in h and 'Предзапусковый режим' not in h",
    "grep -q 'name=\"robots\" content=\"index,follow\"' dist/site/ugmu/index.html",
    "grep -q 'Календарь доступен' dist/site/ugmu/index.html",
  ]) assert.ok(prepare.includes(marker), `post-launch UGMU Pages marker missing: ${marker}`);
  assert.doesNotMatch(prepare, /replacements=\{/);
  assert.doesNotMatch(prepare, /noindex,follow/);
});

test("post-deploy verification requires all three public landing paths", () => {
  const verify = stepBlock("Verify all production landing paths");
  assert.match(verify, /kirov-gmu-calendar\/\?shared=/);
  assert.match(verify, /kirov-gmu-calendar\/omgmu\/\?shared=/);
  assert.match(verify, /kirov-gmu-calendar\/ugmu\/\?shared=/);
  assert.match(verify, /name=\"robots\" content=\"index,follow\"/);
  assert.match(verify, /Календарь доступен/);
});
