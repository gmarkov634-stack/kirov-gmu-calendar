import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pre-connect personalization explains that settings remain editable", async () => {
  const script = await read("landing/acquisition-ux-refinements.js");
  assert.match(script, /\.acquisition-personalization/);
  assert.match(script, /Настройки можно изменить позже на странице управления календарём\./);
  assert.match(script, /data-acquisition-management-note/);
});

test("trial email handoff anchors at the start of its container without focusing the field", async () => {
  const script = await read("landing/acquisition-ux-refinements.js");
  assert.match(script, /#runtime-trial-email/);
  assert.match(script, /closest\("\.trial-connect-card"\)/);
  assert.match(script, /trialEmailAnchor/);
  assert.match(script, /card\.scrollIntoView\(\{ block: "start", inline: "nearest" \}\)/);
  assert.doesNotMatch(script, /\.focus\(/);
});

test("both public landing builders load UX refinements after acquisition wiring", async () => {
  for (const path of ["deploy/build-pages.sh", "deploy/build-landing.sh"]) {
    const builder = await read(path);
    const acquisition = builder.indexOf("acquisition-ui.js");
    const refinements = builder.indexOf("acquisition-ux-refinements.js");
    assert.ok(acquisition >= 0, `${path}: acquisition wiring missing`);
    assert.ok(refinements > acquisition, `${path}: refinement script must be inserted after acquisition wiring`);
  }
});
