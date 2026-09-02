import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);

async function availabilityText() {
  return readFile(availabilityUrl, "utf8");
}

test("pediatrics courses 2 and 3 are exposed in the landing availability status", async () => {
  const source = await availabilityText();

  assert.match(source, /"231", "232", "233", "234", "235", "236", "237", "238", "239"/);
  assert.match(source, /"331", "332", "333", "334", "335", "336", "337"/);
  assert.match(source, /1–3 курсы доступны/);
  assert.match(source, /Педиатрия: 1–3 курсы опубликованы/);
  assert.match(source, /Группы 131–140, 231–239 и 331–337/);
  assert.match(source, /if \(title === "2 курс"\) setText\(note, "Группы 231–239 доступны"\)/);
  assert.match(source, /if \(title === "3 курс"\) setText\(note, "Группы 331–337 доступны"\)/);
  assert.match(source, /педиатрия: группы 131–140, 231–239 и 331–337/);
});
