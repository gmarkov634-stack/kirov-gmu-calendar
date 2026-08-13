import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../../payment-test.html", import.meta.url), "utf8");

test("archived payment test page defaults to the published KGMU medicine group 401 E2E case", () => {
  assert.match(html, /<option value="medicine" selected>Лечебное дело<\/option>/);
  assert.match(html, /<option value="4" selected>4<\/option>/);
  assert.match(html, /id="academic-year" value="2025\/26"/);
  assert.match(html, /<option value="2" selected>2<\/option>/);
  assert.match(html, /id="group-code"[^>]*value="401"/);
});

test("archived payment page shows only test payment credentials", () => {
  assert.match(html, /5555 5555 5555 4477/);
  assert.match(html, /01\/30/);
  assert.match(html, /CVC 123/);
  assert.match(html, /3-D Secure 123/);
  assert.match(html, /noindex,nofollow/);
});
