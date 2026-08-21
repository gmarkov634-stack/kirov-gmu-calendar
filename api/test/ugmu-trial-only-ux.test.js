import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../ugmu/index.html", import.meta.url), "utf8");
const ux = fs.readFileSync(new URL("../../ugmu/trial-only-ux.js", import.meta.url), "utf8");

test("UGMU loads the trial-only UX guard after the main app", () => {
  assert.match(html, /<script src="app\.js"><\/script>\s*<script src="trial-only-ux\.js"><\/script>/);
});

test("trial-only UX hides paid controls unless sales and live payments are both open", () => {
  assert.match(ux, /meta\?\.sales === "open" && meta\?\.paymentMode === "live"/);
  assert.match(ux, /emailField\.hidden = !visible/);
  assert.match(ux, /emailNote\.hidden = !visible/);
  assert.match(ux, /submit\.hidden = !visible/);
  assert.match(ux, /setPaidControlsVisible\(false\)/);
});

test("trial continuation copy remains consistent while UGMU sales are closed", () => {
  assert.match(ux, /Пробная неделя уже использована\. Ваша группа сохранена\./);
  assert.match(ux, /Полный доступ для УГМУ пока закрыт\. Когда продажи откроются, можно будет продолжить с группы/);
  assert.match(ux, /Перейти к полному доступу/);
  assert.match(ux, /button\.hidden = true/);
});

test("saved-order recovery is exposed only after the API confirms a paid order", () => {
  assert.match(ux, /restoreOrderButton\.hidden = true/);
  assert.match(ux, /order\.status !== "succeeded"/);
  assert.match(ux, /validHttpsUrl\(order\.subscriptionUrl\)/);
  assert.match(ux, /restoreOrderButton\.hidden = false/);
});
