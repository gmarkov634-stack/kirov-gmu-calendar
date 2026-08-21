import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const apiDir = process.cwd();
const root = path.resolve(apiDir, "..");
const configCode = fs.readFileSync(path.join(root, "site/ugmu/config.js"), "utf8");
const app = fs.readFileSync(path.join(root, "site/ugmu/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "site/ugmu/index.html"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(configCode, sandbox);
const config = sandbox.window.UGMU_CONFIG;

test("UGMU checkout UI is frozen to the approved first-stream scope", () => {
  assert.equal(config.university, "ugmu");
  assert.equal(config.academicYear, "2026/2027");
  assert.equal(config.semester, 1);
  assert.equal(config.sourceSha256, "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8");
  assert.equal(config.program.id, "medicine");
  assert.equal(config.program.course, 1);
  assert.equal(String(config.program.stream), "1");
  assert.deepEqual(Array.from(config.groups, (group) => group.code), Array.from({ length: 12 }, (_, i) => `ОЛД ${101 + i}`));
});

test("UGMU config contains routing metadata but no static sales authority", () => {
  assert.match(config.apiBaseUrl, /^https:\/\//);
  assert.equal(config.paymentPath, "/api/v2/payments");
  assert.equal(config.defaultPlan, "semester");
  for (const forbidden of ["previewOnly", "checkoutEnabled", "publicIcsEnabled", "testMode", "priceRub"]) {
    assert.equal(Object.hasOwn(config, forbidden), false, forbidden);
    assert.equal(configCode.includes(forbidden), false, forbidden);
  }
});

test("UGMU live UI starts disabled and requires runtime sales plus live YooKassa", () => {
  assert.match(html, /id="order-form"/);
  assert.match(html, /type="submit" disabled/);
  assert.match(html, /id="email"[^>]*type="email"/);
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.ok(app.includes('fetch(`${config.apiBaseUrl}/api/v2/meta`'));
  assert.ok(app.includes('runtime.sales === "open"'));
  assert.ok(app.includes('runtime.paymentMode === "live"'));
  assert.ok(app.includes('checkoutReady()'));
  assert.ok(app.includes('fetch(`${config.apiBaseUrl}${config.paymentPath}`'));
  assert.ok(app.includes('university_id: config.university'));
  assert.ok(app.includes('groupId: groupId(group)'));
  assert.ok(app.includes('plan: config.defaultPlan'));
});

test("UGMU UI remains paid-only and does not depend on public catalog or schedule endpoints", () => {
  assert.doesNotMatch(app, /\/api\/v2\/catalog\/ugmu/);
  assert.doesNotMatch(app, /\/api\/v2\/schedules\/ugmu/);
  assert.doesNotMatch(html, /calendar\.ics|webcal:\/\//);
  assert.ok(app.includes('order.subscriptionUrl'));
  assert.ok(app.includes('replace(/^https:/, "webcal:")'));
});

test("UGMU payment return and saved-order recovery are implemented", () => {
  for (const marker of [
    "confirmationUrl",
    "accessToken",
    "renderOrderResult",
    "showSucceededOrder",
    "restoreOrderForm",
    "enableSavedOrderRecovery",
    "X-Order-Token",
    "#order-status",
  ]) assert.ok(app.includes(marker), marker);
});
