import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const index = fs.readFileSync(new URL("../../ugmu/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../ugmu/app.js", import.meta.url), "utf8");
const configSource = fs.readFileSync(new URL("../../ugmu/config.js", import.meta.url), "utf8");

function landingConfig() {
  // config.js also owns the viewport-anchor listener used after a group choice.
  // The listener is inert while loading configuration in this VM test, but the
  // browser global must exist so the config object can still be inspected.
  const sandbox = {
    window: {},
    document: { addEventListener() {} },
  };
  vm.runInNewContext(configSource, sandbox, { filename: "ugmu/config.js" });
  return sandbox.window.UGMU_CONFIG;
}

test("UGMU landing exposes a payment-independent trial entry point", () => {
  const config = landingConfig();
  assert.equal(config.university, "ugmu");
  assert.equal(config.trialPath, "/api/v2/trials");
  assert.equal(config.trialDays, 7);

  assert.match(index, /id="trial-start"/);
  assert.match(index, /Без банковской карты и без email/);
  assert.match(app, /Email нужен для заказа полного календаря/);

  assert.doesNotThrow(() => new Function(app));
  assert.match(app, /fetch\(`\$\{config\.apiBaseUrl\}\$\{config\.trialPath\}`/);
  assert.match(app, /university: config\.university/);
  assert.match(app, /groupId: groupId\(group\)/);
  assert.match(app, /trial_already_claimed/);
  assert.match(app, /state\.conversionId \? \{ conversionId: state\.conversionId \} : \{\}/);
  assert.match(app, /\/continue\/\$\{encodeURIComponent\(conversionId\)\}/);
});

test("UGMU trial CTA uses only the dedicated read-only UGMU meta state", () => {
  assert.doesNotMatch(app, /meta\.trials/);
  assert.match(app, /meta\.universityTrials\?\.ugmu === "open"/);
  assert.match(app, /runtime\.trial === "open"/);
  assert.match(app, /Бесплатная неделя сейчас недоступна/);
  assert.match(app, /if \(!trialReady\(\)\) return/);
  assert.doesNotMatch(app, /TRIALS_ENABLED/);
  assert.doesNotMatch(app, /UGMU_TRIALS_ENABLED/);
  assert.match(app, /friendlyTrialError/);
  assert.match(app, /university_trials_not_open/);
});
