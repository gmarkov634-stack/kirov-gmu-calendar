import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("personalization is staged outside the offer and mounted only beside email", async () => {
  const script = await read("landing/trial-personalization.js");

  assert.match(script, /\.group-preview/);
  assert.match(script, /\.acquisition-personalization/);
  assert.match(script, /panel\.hidden = true/);
  assert.match(script, /#runtime-trial-form, #runtime-checkout-form/);
  assert.match(script, /form\.insertBefore\(stagedPanel, submit\)/);
  assert.match(script, /personalizationEmailStep/);
});

test("email-step personalization reuses acquisition state instead of creating a second preference model", async () => {
  const script = await read("landing/trial-personalization.js");

  assert.doesNotMatch(script, /globalThis\.fetch\s*=/);
  assert.doesNotMatch(script, /createElement\("select"\)/);
  assert.doesNotMatch(script, /data-trial-personalization-root/);
});

test("acquisition wiring still sends the reused preference state to both trial and checkout", async () => {
  const script = await read("landing/acquisition-ui.js");

  assert.match(script, /isTrial \|\| isCheckout/);
  assert.match(script, /body\.preferences = clonePreferences\(\)/);
});

test("production builders load acquisition state before email-step placement", async () => {
  for (const path of ["deploy/build-pages.sh", "deploy/build-landing.sh"]) {
    const builder = await read(path);
    const acquisition = builder.indexOf("acquisition-ui.js");
    const placement = builder.indexOf("trial-personalization.js");
    assert.ok(acquisition >= 0, `${path}: acquisition script missing`);
    assert.ok(placement > acquisition, `${path}: email-step placement must load after acquisition state`);
  }
});
