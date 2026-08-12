import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listOfferProgramAvailability } from "../src/offer-availability.js";

async function touch(dataDir, key) {
  const filename = path.join(dataDir, key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, "{}", "utf8");
}

test("program availability uses only publications from the current offer period", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-offer-availability-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await touch(dataDir, "schedules/kgmu/medicine/2/2026-2027/semester-1/kgmu%3Amedicine%3A2%3A201.json");
  await touch(dataDir, "schedules/kgmu/medicine/3/2025-2026/semester-2/kgmu%3Amedicine%3A3%3A301.json");
  await touch(dataDir, "schedules/kgmu/pediatrics/1/kgmu%3Apediatrics%3A1%3A131.json");
  await touch(dataDir, "schedule-bundles/kgmu/dentistry/4/2026-2027/semester-1/current.json");
  await touch(dataDir, "schedule-bundles/kgmu/foreign/6/2026-2027/semester-2/current.json");
  await touch(dataDir, "schedule-bundles/kgmu/dentistry/4/2026-2027/semester-1/versions/abc.json");

  const store = {
    config: { dataDir, cacheTtlMs: 60_000 },
    cache: new Map(),
    s3: null,
  };
  const result = await listOfferProgramAvailability({
    store,
    university: "kgmu",
    academicYear: "2026/27",
    semester: 1,
  });

  assert.deepEqual(result, [
    { program: "dentistry", courses: [4] },
    { program: "medicine", courses: [2] },
  ]);
});

test("program availability cache is reused until publication clears the store cache", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-offer-availability-cache-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await touch(dataDir, "schedules/kgmu/medicine/1/2026-2027/semester-1/kgmu%3Amedicine%3A1%3A101.json");

  const store = {
    config: { dataDir, cacheTtlMs: 60_000 },
    cache: new Map(),
    s3: null,
  };
  const input = { store, university: "kgmu", academicYear: "2026/27", semester: 1 };
  const first = await listOfferProgramAvailability(input);
  await fs.rm(path.join(dataDir, "schedules"), { recursive: true, force: true });
  const second = await listOfferProgramAvailability(input);
  assert.deepEqual(second, first);

  store.cache.clear();
  assert.deepEqual(await listOfferProgramAvailability(input), []);
});
