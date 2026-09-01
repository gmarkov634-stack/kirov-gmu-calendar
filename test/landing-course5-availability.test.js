import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);

async function availabilityText() {
  return readFile(availabilityUrl, "utf8");
}

test("medicine course 5 is exposed only after production publication and protected ICS verification", async () => {
  const source = await availabilityText();

  assert.match(source, /"501", "502", "503", "504", "505", "506", "507", "508", "509", "510"/);
  assert.match(source, /"511", "512", "513", "514", "515", "516"/);
  assert.match(source, /1–5 курсы доступны/);
  assert.match(source, /Лечебное дело: 1–5 курсы опубликованы/);
  assert.match(source, /if \(title === "5 курс"\) setText\(note, "Группы 501–516 доступны"\)/);
  assert.match(source, /401–416 и 501–516/);

  assert.doesNotMatch(source, /"601"/);
  assert.doesNotMatch(source, /1–6 курсы доступны/);
  assert.doesNotMatch(source, /title === "6 курс"/);
});
