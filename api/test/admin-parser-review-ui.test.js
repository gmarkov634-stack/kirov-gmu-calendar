import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "admin.js"), "utf8");

test("admin parser review dashboard is wired to protected review, email, and side-effect-free dry-run endpoints", () => {
  assert.match(html, /Расписания на проверке/);
  assert.match(html, /Проверить XLSX без публикации/);
  assert.match(html, /Review, письмо и публикация не создаются/);
  assert.match(html, /id="review-list"/);
  assert.match(html, /id="email-test"/);
  assert.match(html, /id="dry-run-file"/);
  assert.match(html, /id="dry-run-program"/);
  assert.match(html, /id="dry-run-course"/);
  assert.match(html, /id="dry-run-year"/);
  assert.match(html, /id="dry-run-semester"/);
  assert.match(html, /id="dry-run-submit"/);
  assert.match(html, /id="dry-run-result"/);
  assert.doesNotMatch(html, /id="max-discover"|id="max-test"|id="telegram-test"/);
  assert.match(js, /\/api\/v1\/admin\/parser-reviews\?limit=100/);
  assert.match(js, /\/parser-reviews\/\$\{review\.reviewId\}\/source/);
  assert.match(js, /\/parser-reviews\/\$\{review\.reviewId\}\/publish/);
  assert.match(js, /\/api\/v1\/admin\/kgmu\/email-test/);
  assert.match(js, /\/api\/v1\/admin\/kgmu\/dry-run/);
  assert.match(js, /body:\s*file/);
  assert.match(js, /Ничего не опубликовано и письмо не отправлялось/);
  assert.doesNotMatch(js, /MAX_ADMIN_USER_ID|\/kgmu\/max-|\/kgmu\/telegram-test/);
  assert.match(js, /record\.groupCode \|\| record\.groupDisplayName/);
  assert.match(js, /review\.status === "READY_TO_PUBLISH"/);
  assert.match(js, /X-Admin-Token/);
  assert.doesNotThrow(() => new Function(js));
});
