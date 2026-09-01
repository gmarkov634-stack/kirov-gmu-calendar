import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("personalization is suppressed before activation and remains editable on the email step", async () => {
  const script = await read("landing/acquisition-ux-refinements.js");
  assert.match(script, /\.group-preview > \.acquisition-personalization/);
  assert.match(script, /emailStepPersonalizationPlaceholder/);
  assert.match(script, /\.trial-personalization, \.acquisition-personalization/);
  assert.match(script, /Настройки можно изменить позже на странице управления календарём\./);
  assert.match(script, /data-acquisition-management-note/);
});

test("iPhone handoff warns that removal of reminders must stay disabled", async () => {
  const script = await read("landing/acquisition-ux-refinements.js");
  assert.match(script, /calendar-device-action\[href\^="webcal:\/\/"\]/);
  assert.match(script, /data-iphone-reminder-guidance/);
  assert.match(script, /выключите «Удаление напоминаний»/);
  assert.match(script, /iOS удалит уведомления из подписного календаря/);
});

test("trial and checkout email handoffs anchor at the start of their container without focusing the field", async () => {
  const script = await read("landing/acquisition-ux-refinements.js");
  assert.match(script, /#runtime-trial-email, #runtime-checkout-email/);
  assert.match(script, /closest\("\.trial-connect-card"\)/);
  assert.match(script, /emailAnchor/);
  assert.match(script, /card\.scrollIntoView\(\{ block: "start", inline: "nearest" \}\)/);
  assert.doesNotMatch(script, /\.focus\(/);
});

test("both public landing builders make email-form preferences the final request preferences", async () => {
  for (const path of ["deploy/build-pages.sh", "deploy/build-landing.sh"]) {
    const builder = await read(path);
    const emailPersonalization = builder.indexOf("trial-personalization.js");
    const acquisition = builder.indexOf("acquisition-ui.js");
    const refinements = builder.indexOf("acquisition-ux-refinements.js");
    assert.ok(emailPersonalization >= 0, `${path}: email personalization missing`);
    assert.ok(acquisition > emailPersonalization, `${path}: acquisition wrapper must load after email personalization`);
    assert.ok(refinements > acquisition, `${path}: refinement script must load after acquisition wiring`);
  }
});