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

test("IzhGMU landing loads config before app and starts group selection disabled", () => {
  const configPos = scriptPosition("../site/izhgmu/config.js");
  const appPos = scriptPosition("../site/izhgmu/app.js");

  assert.ok(configPos >= 0);
  assert.ok(appPos > configPos);
  assert.match(html, /<select id="course-select" disabled>/);
  assert.match(html, /<select id="group-select" disabled>/);
});

test("IzhGMU landing gets programs and groups only from the server catalog", () => {
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(university\)\}\/programs/);
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(university\)\}\/\$\{encodeURIComponent\(program\)\}\/\$\{course\}\/groups/);
  assert.match(app, /data\?\.error === "catalog_not_available"/);
  assert.match(app, /Array\.isArray\(data\?\.groups\)/);
  assert.doesNotMatch(app, /fallbackGroups|staticGroups|defaultGroups/i);
});

test("IzhGMU prelaunch landing contains no checkout or payment authority", () => {
  const combined = `${html}\n${config}\n${app}`;
  assert.doesNotMatch(combined, /\/api\/v2\/payments/i);
  assert.doesNotMatch(combined, /create[-_]?payment/i);
  assert.doesNotMatch(combined, /checkout/i);
  assert.doesNotMatch(combined, /yookassa/i);
  assert.match(html, /Продажи и подключение пока закрыты/);
});

test("IzhGMU landing javascript parses", () => {
  assert.doesNotThrow(() => new Function(app));
});
