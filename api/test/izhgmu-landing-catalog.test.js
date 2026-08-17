import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const html = fs.readFileSync(path.join(repoRoot, "izhgmu/index.html"), "utf8");
const config = fs.readFileSync(path.join(repoRoot, "site/izhgmu/config.js"), "utf8");
const app = fs.readFileSync(path.join(repoRoot, "site/izhgmu/app.js"), "utf8");

function scriptPosition(src) {
  return html.indexOf(`<script src="${src}"></script>`);
}

test("IzhGMU landing keeps the approved medicine 1-3 scope without hardcoded groups", () => {
  assert.match(config, /university:\s*"izhgmu"/);
  assert.match(config, /program:\s*"medicine"/);
  assert.match(config, /prelaunchCourses:\s*Object\.freeze\(\[1, 2, 3\]\)/);

  const combined = `${html}\n${config}\n${app}`;
  assert.doesNotMatch(combined, /\b(?:10[1-9]|1[12]\d|130|20[1-9]|2[12]\d|230|30[1-9]|31\d|32[0-6])\b/);
});

test("IzhGMU landing uses the shared live API but keeps commercial authority server-side", () => {
  assert.match(config, /apiBaseUrl:\s*"https:\/\/kgmu-calendar-api\.containerapps\.ru"/);
  assert.match(config, /paymentPath:\s*"\/api\/v2\/payments"/);
  assert.match(config, /timezone:\s*"Europe\/Samara"/);
  assert.doesNotMatch(config, /price|salesEnabled|trialsEnabled|commercialEnabled/i);
});

test("IzhGMU landing loads config before app and personalization, with actions fail-closed initially", () => {
  const configPos = scriptPosition("../site/izhgmu/config.js");
  const appPos = scriptPosition("../site/izhgmu/app.js");
  const personalizationPos = scriptPosition("../subscription-personalization-ui.js?v=electives-1");

  assert.ok(configPos >= 0);
  assert.ok(appPos > configPos);
  assert.ok(personalizationPos > appPos);
  assert.match(html, /subscription-personalization-ui\.css\?v=electives-1/);
  assert.match(html, /<select id="course-select" disabled>/);
  assert.match(html, /<select id="group-select" disabled>/);
  assert.match(html, /<section id="subscription-actions"[^>]*hidden>/);
  assert.match(html, /id="trial-button"[^>]*disabled[^>]*hidden/);
  assert.match(html, /<form id="payment-form"[^>]*hidden>/);
});

test("IzhGMU landing gets programs and groups only from the server catalog", () => {
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(university\)\}\/programs/);
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(university\)\}\/\$\{encodeURIComponent\(program\)\}\/\$\{course\}\/groups/);
  assert.match(app, /error\.message === "catalog_not_available"/);
  assert.match(app, /Array\.isArray\(data\?\.groups\)/);
  assert.match(app, /groupById\.get\(groupSelect\.value\)/);
  assert.doesNotMatch(app, /fallbackGroups|staticGroups|defaultGroups/i);
});

test("IzhGMU trial and checkout handoff require the university and global server gates", () => {
  for (const required of [
    "/api/v2/meta?university=",
    "/api/v2/trials",
    "/api/v2/trials/continue/",
    "/api/v1/orders/",
    "universityCommercial",
    "runtime.trials === \"open\"",
    "runtime.sales === \"open\"",
    "selectedGroupContext()",
  ]) {
    assert.ok(app.includes(required), `missing IzhGMU handoff invariant: ${required}`);
  }
  assert.match(app, /runtime\.universityCommercial === "open"/);
  assert.match(app, /fetch\(apiUrl\(config\.paymentPath \|\| "\/api\/v2\/payments"\)/);
  assert.match(app, /groupCode:\s*group\.groupCode/);
  assert.match(app, /groupId:\s*group\.groupId/);
  assert.doesNotMatch(app, /yookassaShopId|secretKey|confirmation_token/i);
});

test("IzhGMU payment form has no static price and personalization remains generic", () => {
  assert.match(html, /Цена и доступные тарифы приходят только с сервера/);
  assert.doesNotMatch(html, /\b(?:299|499|490)\s*₽/);
  assert.match(app, /runtime\.offers\?\.\[id\]\?\.price/);
  assert.match(app, /validSubscriptionUrl/);
  assert.match(app, /subscription-https-link/);
});

test("IzhGMU landing javascript parses", () => {
  assert.doesNotThrow(() => new Function(app));
});