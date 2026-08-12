import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const js = fs.readFileSync(path.join(root, "admin.js"), "utf8");

test("admin parser review dashboard is wired to protected review endpoints", () => {
  assert.match(html, /Расписания на проверке/);
  assert.match(html, /id="review-list"/);
  assert.match(js, /\/api\/v1\/admin\/parser-reviews\?limit=100/);
  assert.match(js, /\/parser-reviews\/\$\{review\.reviewId\}\/source/);
  assert.match(js, /\/parser-reviews\/\$\{review\.reviewId\}\/publish/);
  assert.match(js, /\/api\/v1\/admin\/kgmu\/telegram-test/);
  assert.match(js, /review\.status === "READY_TO_PUBLISH"/);
  assert.match(js, /X-Admin-Token/);
  assert.doesNotThrow(() => new Function(js));
});
