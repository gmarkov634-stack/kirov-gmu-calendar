import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync("../.github/workflows/omgmu-pages.yml", "utf8");

function stepBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(new RegExp(`      - name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - name:|\\n  deploy:)`));
  assert.ok(match, `workflow step is missing: ${name}`);
  return match[0];
}

test("Pages production artifact is built on pull requests but deployment remains main-only", () => {
  const prepare = stepBlock("Prepare production artifact");
  assert.doesNotMatch(prepare, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(prepare, /curl --fail --silent --show-error --max-time 20 \"\$CLOUD_RU_API_URL\/health\"/);
  assert.match(prepare, /Access-Control-Request-Method: POST/);
  assert.match(prepare, /mkdir -p dist\/site\/omgmu dist\/site\/ugmu/);

  const evidence = stepBlock("Upload PR Pages build evidence");
  assert.match(evidence, /if:\s*github\.event_name == 'pull_request'/);
  assert.match(evidence, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(evidence, /path:\s*dist\/site/);

  const pagesArtifact = stepBlock("Upload Pages artifact");
  assert.match(pagesArtifact, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(pagesArtifact, /uses:\s*actions\/upload-pages-artifact@v3/);

  assert.match(workflow, /deploy:\n    if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /uses:\s*actions\/deploy-pages@v4/);
});

test("UGMU artifact gate is live-checkout-ready but remains noindex and runtime fail-closed", () => {
  const prepare = stepBlock("Prepare production artifact");
  for (const marker of [
    "grep -q \"apiBaseUrl: \\\"$CLOUD_RU_API_URL\\\"\" dist/site/ugmu/config.js",
    "grep -q 'paymentPath: \"/api/v2/payments\"' dist/site/ugmu/config.js",
    "grep -q 'defaultPlan: \"semester\"' dist/site/ugmu/config.js",
    "grep -q '34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8' dist/site/ugmu/config.js",
    "grep -q 'name=\"robots\" content=\"noindex,follow\"' dist/site/ugmu/index.html",
    "grep -q '/api/v2/meta' dist/site/ugmu/app.js",
    "grep -q 'config.paymentPath' dist/site/ugmu/app.js",
    "grep -q 'runtime.sales === \"open\"' dist/site/ugmu/app.js",
    "grep -q 'runtime.paymentMode === \"live\"' dist/site/ugmu/app.js",
    "! grep -q 'previewOnly' dist/site/ugmu/config.js",
    "! grep -q 'checkoutEnabled' dist/site/ugmu/config.js",
    "! grep -q 'publicIcsEnabled' dist/site/ugmu/config.js",
    "! grep -R '/api/v2/catalog/ugmu' dist/site/ugmu",
    "! grep -R '/api/v2/schedules/ugmu' dist/site/ugmu",
  ]) {
    assert.ok(prepare.includes(marker), `UGMU Pages live-checkout marker missing: ${marker}`);
  }
});
