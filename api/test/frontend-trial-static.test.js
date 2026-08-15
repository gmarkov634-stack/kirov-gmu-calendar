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

test("trial landing javascript parses", async () => {
  const source = await readRoot("app.js");
  assert.doesNotThrow(() => new Function(source));
});

test("group selection uses preview before checkout and calls required APIs", async () => {
  const source = await readRoot("app.js");
  assert.ok(source.includes('setStep("preview")'));
  for (const required of [
    "/api/v2/meta",
    "/api/v2/trials",
    "/api/v2/trials/continue/",
    "/preview",
    "conversionId",
    "trial_to_paid",
  ]) {
    assert.ok(source.includes(required), `missing frontend invariant: ${required}`);
  }
});

test("landing keeps discovery fail-closed in static HTML", async () => {
  const html = await readRoot("index.html");
  assert.equal((html.match(/data-step-indicator=/g) || []).length, 3);
  assert.equal(html.includes('data-step-indicator="checkout"'), false);
  assert.ok(html.includes('id="hero-primary-cta"'));
  assert.ok(html.includes("Выбрать свою группу"));
  assert.equal(html.includes('id="hero-primary-cta">Попробовать свою группу бесплатно'), false);
  assert.ok(html.includes("trial.css?v=trial-1"));
});

test("trial stylesheet contains preview and onboarding states", async () => {
  const css = await readRoot("trial.css");
  for (const className of [".group-preview", ".trial-connect-card", ".trial-replace-note", ".checkout-context"]) {
    assert.ok(css.includes(className), `missing trial style: ${className}`);
  }
});
