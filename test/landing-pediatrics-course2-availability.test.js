import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);

async function availabilityText() {
  return readFile(availabilityUrl, "utf8");
}

test("pediatrics course 2 is exposed in the landing availability status", async () => {
  const source = await availabilityText();

  assert.match(source, /"231", "232", "233", "234", "235", "236", "237", "238", "239"/);
  assert.match(source, /1–2 курсы доступны/);
  assert.match(source, /Педиатрия: 1–2 курсы опубликованы/);
  assert.match(source, /Группы 131–140 и 231–239/);
  assert.match(source, /if \(title === "2 курс"\) setText\(note, "Группы 231–239 доступны"\)/);
  assert.match(source, /педиатрия: группы 131–140 и 231–239/);
});
