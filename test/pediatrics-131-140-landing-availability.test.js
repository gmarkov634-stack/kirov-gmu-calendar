import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);

async function availabilityText() {
  return readFile(availabilityUrl, "utf8");
}

test("pediatrics course 1 exposes only groups 131-140 after verified publication", async () => {
  const source = await availabilityText();

  for (let group = 131; group <= 140; group += 1) {
    assert.match(source, new RegExp(`\\"${group}\\"`), String(group));
  }
  assert.doesNotMatch(source, /"141"/);

  assert.match(source, /program === "Педиатрия"/);
  assert.match(source, /1 курс доступен/);
  assert.match(source, /Группы 131–140 · опубликованы и доступны/);
  assert.match(source, /Педиатрия: 1 курс опубликован/);
  assert.match(source, /const isPediatrics = selectorHeading\.startsWith\("Педиатрический факультет"\)/);
  assert.match(source, /if \(isPediatrics && title === "1 курс"\) setText\(note, "Группы 131–140 доступны"\)/);
});

test("medicine course labels remain faculty-scoped when pediatrics is exposed", async () => {
  const source = await availabilityText();

  assert.match(source, /const isMedicine = selectorHeading\.startsWith\("Лечебный факультет"\)/);
  assert.match(source, /if \(isMedicine\) \{/);
  assert.match(source, /if \(title === "1 курс"\) setText\(note, "Группы 101–120 доступны"\)/);
  assert.match(source, /if \(title === "6 курс"\) setText\(note, "Группы 601–616 доступны"\)/);
});
