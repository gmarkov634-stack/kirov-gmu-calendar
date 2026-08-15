import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function source(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("landing loads analytics before app runtime", () => {
  const html = source("index.html");
  const analyticsIndex = html.indexOf('src="analytics.js?v=funnel-1"');
  const appIndex = html.indexOf('src="app.js?v=trial-1"');
  assert.ok(analyticsIndex > 0);
  assert.ok(appIndex > analyticsIndex);
});

test("frontend analytics is session-scoped, privacy-safe and observes funnel API calls", () => {
  const js = source("analytics.js");
  assert.match(js, /sessionStorage/);
  assert.match(js, /crypto\.getRandomValues/);
  assert.match(js, /\/api\/v2\/analytics/);
  assert.match(js, /\/api\/v2\/trials/);
  assert.match(js, /\/api\/v2\/payments/);
  assert.ok(js.includes("\\/api\\/v2\\/catalog\\/") || js.includes("/api/v2/catalog/"));
  assert.match(js, /\/api\/v2\/trials\/continue\//);
  assert.match(js, /\/api\/v1\/orders\//);
  assert.doesNotMatch(js, /document\.cookie/);
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /navigator\.userAgent/);
  assert.doesNotMatch(js, /document\.referrer/);
  assert.doesNotMatch(js, /subscriptionUrl\s*:/);
});