import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("FUNNEL_ANALYTICS_ENABLED is fail-closed and exact", () => {
  assert.equal(loadConfig({}).funnelAnalyticsEnabled, false);
  assert.equal(loadConfig({ FUNNEL_ANALYTICS_ENABLED: "true" }).funnelAnalyticsEnabled, true);
  assert.equal(loadConfig({ FUNNEL_ANALYTICS_ENABLED: "TRUE" }).funnelAnalyticsEnabled, false);
  assert.equal(loadConfig({ FUNNEL_ANALYTICS_ENABLED: "1" }).funnelAnalyticsEnabled, false);
});
