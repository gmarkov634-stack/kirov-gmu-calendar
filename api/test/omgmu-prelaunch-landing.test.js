import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

async function text(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

test("OmGMU prelaunch landing stays fail-closed before a live group exists", async () => {
  const [publicHtml, siteHtml, app, config] = await Promise.all([
    text("omgmu/index.html"),
    text("site/omgmu/index.html"),
    text("site/omgmu/app.js"),
    text("site/omgmu/config.js"),
  ]);

  for (const html of [publicHtml, siteHtml]) {
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.equal((html.match(/mobile\.css/g) || []).length, 1);
    assert.match(html, /class="secondary program-select"[^>]*hidden/);
    assert.match(html, /id="course" required disabled/);
    assert.match(html, /id="stream" disabled/);
    assert.match(html, /id="group" required disabled/);
    assert.match(html, /type="submit" disabled/);
    assert.doesNotMatch(html, /groups\.js/);
  }

  assert.match(app, /sales:\s*'closed'/);
  assert.match(app, /submit\.disabled\s*=\s*runtime\.sales\s*!==\s*'open'/);
  assert.match(app, /if \(runtime\.sales !== 'open'\)/);
  assert.match(app, /Не удалось подтвердить опубликованные группы\. Продажа для них не открывается\./);
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(config\.university\)\}\/programs/);
  assert.match(app, /\/groups/);

  assert.doesNotMatch(config, /groups\s*:/);
  assert.doesNotMatch(config, /checkoutEnabled|priceRub|testMode/);
});

test("OmGMU mobile contract protects iPhone/Safari layout before launch", async () => {
  const mobile = await text("site/omgmu/mobile.css");

  assert.match(mobile, /overflow-x:\s*hidden/);
  assert.match(mobile, /-webkit-text-size-adjust:\s*100%/);
  assert.match(mobile, /\.order-panel input[\s\S]*font-size:\s*16px/);
  assert.match(mobile, /env\(safe-area-inset-bottom\)/);
  assert.match(mobile, /touch-action:\s*manipulation/);
  assert.match(mobile, /@media \(max-width:\s*390px\)/);
  assert.match(mobile, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
