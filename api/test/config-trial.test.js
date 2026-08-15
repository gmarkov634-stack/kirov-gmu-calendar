import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("TRIALS_ENABLED is fail-closed and independent from sales", () => {
  const closed = loadConfig({ COMMERCIAL_SALES_ENABLED: "true" });
  assert.equal(closed.commercialSalesEnabled, true);
  assert.equal(closed.trialsEnabled, false);

  for (const value of ["TRUE", "1", "yes", "false", " true "]) {
    assert.equal(loadConfig({ TRIALS_ENABLED: value }).trialsEnabled, false);
  }

  const trialOnly = loadConfig({ TRIALS_ENABLED: "true", COMMERCIAL_SALES_ENABLED: "false" });
  assert.equal(trialOnly.trialsEnabled, true);
  assert.equal(trialOnly.commercialSalesEnabled, false);
});
