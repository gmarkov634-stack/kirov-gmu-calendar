import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("shared API has no primary university site", () => {
  const config = loadConfig({
    KGMU_SITE_URL: "https://kgmu.example.test/",
    OMGMU_SITE_URL: "https://omgmu.example.test/",
    PGMU_SITE_URL: "https://pgmu.example.test/",
    PUBLIC_API_URL: "https://api.example.test",
  });

  assert.equal(Object.hasOwn(config, "publicSiteUrl"), false);
  assert.deepEqual(config.universitySiteUrls, {
    kgmu: "https://kgmu.example.test/",
    omgmu: "https://omgmu.example.test/",
    pgmu: "https://pgmu.example.test/",
  });
  assert.equal(config.publicApiUrl, "https://api.example.test");
});

test("unconfigured university landings stay empty instead of falling back to KGMU", () => {
  const config = loadConfig({ PUBLIC_API_URL: "https://api.example.test" });
  assert.deepEqual(config.universitySiteUrls, { kgmu: "", omgmu: "", pgmu: "" });
});
