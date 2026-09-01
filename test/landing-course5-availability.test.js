import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);

async function availabilityText() {
  return readFile(availabilityUrl, "utf8");
}

test("medicine course 5 remains exposed when published course 6 is added", async () => {
  const source = await availabilityText();

  assert.match(source, /"501", "502", "503", "504", "505", "506", "507", "508", "509", "510"/);
  assert.match(source, /"511", "512", "513", "514", "515", "516"/);
  assert.match(source, /1–6 курсы доступны/);
  assert.match(source, /Лечебное дело: 1–6 курсы опубликованы/);
  assert.match(source, /if \(title === "5 курс"\) setText\(note, "Группы 501–516 доступны"\)/);
  assert.match(source, /501–516 и 601–616/);

  assert.match(source, /"601", "602", "603", "604", "605", "606", "607", "608", "609", "610"/);
  assert.match(source, /"611", "612", "613", "614", "615", "616"/);
  assert.match(source, /if \(title === "6 курс"\) setText\(note, "Группы 601–616 доступны"\)/);
  assert.doesNotMatch(source, /"617"/);
});
