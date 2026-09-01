import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const availabilityUrl = new URL("../landing/availability-status.js", import.meta.url);
const catalogUrl = new URL("../catalog/2026-2027-semester-1.json", import.meta.url);
const buildUrl = new URL("../deploy/build-landing.sh", import.meta.url);

const text = (url) => readFile(url, "utf8");

test("landing retains published medicine course-3 groups 301-317 while course 5 is enabled", async () => {
  const availability = await text(availabilityUrl);
  for (let group = 301; group <= 317; group += 1) {
    assert.match(availability, new RegExp(`\\"${group}\\"`), String(group));
  }
  assert.doesNotMatch(availability, /"318"/);
  assert.match(availability, /1–5 курсы доступны/);
  assert.match(availability, /Группы 301–317 доступны/);
  assert.match(availability, /101–120, 201–220, 301–317, 401–416 и 501–516/);
});

test("course-3 landing availability matches the catalog boundary", async () => {
  const catalog = JSON.parse(await text(catalogUrl));
  const medicine = catalog.programs.find((program) => program.programId === "medicine");
  const course3 = medicine?.courses.find((entry) => entry.course === 3);
  assert.deepEqual(course3?.groupIds, Array.from({ length: 17 }, (_, index) => String(301 + index)));
});

test("production landing artifact installs the availability overlay", async () => {
  const build = await text(buildUrl);
  assert.match(build, /availability-status\.js/);
  assert.match(build, /<\\\/body>/);
});
