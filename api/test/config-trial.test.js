import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("TRIALS_ENABLED is fail-closed and independent from sales", () => {
  const closed = loadConfig({ COMMERCIAL_SALES_ENABLED: "true" });
  assert.equal(closed.commercialSalesEnabled, true);
  assert.equal(closed.trialsEnabled, false);
  assert.equal(closed.globalTrialsEnabled, false);
  assert.equal(closed.ugmuTrialsEnabled, false);
  assert.equal(closed.trialServiceEnabled, false);

  for (const value of ["TRUE", "1", "yes", "false", " true "]) {
    assert.equal(loadConfig({ TRIALS_ENABLED: value }).trialsEnabled, false);
    assert.equal(loadConfig({ UGMU_TRIALS_ENABLED: value }).ugmuTrialsEnabled, false);
  }

  const trialOnly = loadConfig({ TRIALS_ENABLED: "true", COMMERCIAL_SALES_ENABLED: "false" });
  assert.equal(trialOnly.trialsEnabled, true);
  assert.equal(trialOnly.globalTrialsEnabled, true);
  assert.equal(trialOnly.ugmuTrialsEnabled, false);
  assert.equal(trialOnly.trialServiceEnabled, true);
  assert.equal(trialOnly.commercialSalesEnabled, false);
  assert.equal(trialOnly.universityAccess.ugmu.trialsEnabled, false);
});

test("UGMU_TRIALS_ENABLED is isolated from global trial and sales flags", () => {
  const ugmuOnly = loadConfig({
    UGMU_TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://example.test/ugmu",
    COMMERCIAL_SALES_ENABLED: "false",
    UGMU_SALES_ENABLED: "false",
    TRIALS_ENABLED: "false",
  });

  assert.equal(ugmuOnly.trialsEnabled, false);
  assert.equal(ugmuOnly.globalTrialsEnabled, false);
  assert.equal(ugmuOnly.ugmuTrialsEnabled, true);
  assert.equal(ugmuOnly.trialServiceEnabled, true);
  assert.equal(ugmuOnly.commercialSalesEnabled, false);
  assert.equal(ugmuOnly.ugmuSalesEnabled, false);
  assert.equal(ugmuOnly.universityAccess.kgmu.checkoutEnabled, false);
  assert.equal(ugmuOnly.universityAccess.omgmu.checkoutEnabled, false);
  assert.equal(ugmuOnly.universityAccess.ugmu.checkoutEnabled, false);
  assert.equal(ugmuOnly.universityAccess.ugmu.trialsEnabled, true);
  assert.equal(ugmuOnly.universitySiteUrls.ugmu, "https://example.test/ugmu");
});
