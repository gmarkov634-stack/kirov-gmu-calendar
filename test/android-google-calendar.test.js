import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const androidScript = new URL("../landing/android-google-calendar.js", import.meta.url);

async function text() {
  return readFile(androidScript, "utf8");
}

test("Android Google Calendar handoff targets Chrome instead of opening the Calendar app", async () => {
  const script = await text();

  assert.match(script, /package=com\.android\.chrome/);
  assert.match(script, /S\.browser_fallback_url=/);
  assert.match(script, /Открыть в Chrome/);
  assert.match(script, /Версия для ПК/);
  assert.doesNotMatch(script, /window\.open\(/);
});

test("Android Chrome handoff never embeds the private ICS URL in the Google destination", async () => {
  const script = await text();

  assert.match(script, /calendar\.google\.com\/calendar\/u\/0\/r\/settings\/addbyurl/);
  assert.doesNotMatch(script, /lastCalendarUrl/);
  assert.doesNotMatch(script, /[?&]cid=/);
  assert.doesNotMatch(script, /\/c\/\$\{/);
});
