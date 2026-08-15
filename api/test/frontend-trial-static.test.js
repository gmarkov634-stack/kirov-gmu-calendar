import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

async function readRoot(name) {
  return fs.readFile(path.join(root, name), "utf8");
}

test("trial landing javascript parses and keeps group selection before checkout", async () => {
  const source = await readRoot("app.js");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /function selectGroup\(group\)[\s\S]*setStep\("preview"\)/);
  assert.doesNotMatch(source, /onClick:\s*\(\)\s*=>\s*\{[^}]*state\.group\s*=\s*group[^}]*setStep\("checkout"\)/);
});

test("trial landing uses server gates and all required backend routes", async () => {
  const source = await readRoot("app.js");
  for (const required of [
    "/api/v2/meta",
    "/api/v2/trials",
    "/api/v2/trials/continue/",
    "/preview",
    "conversionId",
    'runtimeMeta.trials === "open"',
    'runtimeMeta.sales === "open"',
    'order.purchasePath === "trial_to_paid"',
  ]) {
    assert.ok(source.includes(required), `missing frontend invariant: ${required}`);
  }
});

test("landing has three discovery steps and does not statically promise an open trial", async () => {
  const html = await readRoot("index.html");
  const indicators = html.match(/data-step-indicator=/g) || [];
  assert.equal(indicators.length, 3);
  assert.doesNotMatch(html, /data-step-indicator="checkout"/);
  assert.match(html, /id="hero-primary-cta"[^>]*>Выбрать свою группу/);
  assert.doesNotMatch(html, /id="hero-primary-cta"[^>]*>Попробовать свою группу бесплатно/);
  assert.match(html, /trial\.css\?v=trial-1/);
});

test("trial stylesheet includes preview connect and replacement states", async () => {
  const css = await readRoot("trial.css");
  for (const className of [".group-preview", ".trial-connect-card", ".trial-replace-note", ".checkout-context"]) {
    assert.ok(css.includes(className), `missing trial style: ${className}`);
  }
});
