import assert from "node:assert/strict";
import test from "node:test";

import {
  UGMU_SCHEDULE_INDEX,
  UGMU_SOURCE_PAGES,
  UGMU_SOURCE_POLICY,
  getUgmuSourcePage,
  isTrustedUgmuArtifactUrl,
  listUgmuSourcePages,
} from "../src/adapters/ugmu/source-registry.mjs";
import { getUniversityConfig } from "../src/universities/registry.mjs";

test("UGMU source registry uses official per-program pages", () => {
  assert.equal(new URL(UGMU_SCHEDULE_INDEX).hostname, "usma.ru");
  assert.equal(listUgmuSourcePages().length, 6);
  assert.deepEqual(listUgmuSourcePages({ initialOnly: true }).map((item) => item.program), ["medicine"]);

  for (const item of listUgmuSourcePages()) {
    const url = new URL(item.page);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "usma.ru");
    assert.match(url.pathname, /\/raspisanie\//);
  }

  assert.equal(getUgmuSourcePage("medicine"), UGMU_SOURCE_PAGES.medicine);
  assert.equal(getUgmuSourcePage("missing"), null);
});

test("UGMU university registry primary page matches initial medicine source", () => {
  const ugmu = getUniversityConfig("ugmu");
  assert.equal(ugmu.source.indexPage, UGMU_SCHEDULE_INDEX);
  assert.equal(ugmu.source.primaryPage, UGMU_SOURCE_PAGES.medicine.page);
  assert.equal(ugmu.source.pageStrategy, "per-program");
  assert.equal(ugmu.active, false);
});

test("UGMU source policy accepts only official HTTPS PDF artifacts", () => {
  assert.equal(UGMU_SOURCE_POLICY.semanticReviewRequired, true);
  assert.equal(isTrustedUgmuArtifactUrl("https://usma.ru/wp-content/uploads/2026/08/1OLD.pdf"), true);
  assert.equal(isTrustedUgmuArtifactUrl("https://www.usma.ru/wp-content/uploads/2026/08/4OLD_PRAKT.pdf"), true);
  assert.equal(isTrustedUgmuArtifactUrl("http://usma.ru/wp-content/uploads/2026/08/1OLD.pdf"), false);
  assert.equal(isTrustedUgmuArtifactUrl("https://evil.example/wp-content/uploads/2026/08/1OLD.pdf"), false);
  assert.equal(isTrustedUgmuArtifactUrl("https://usma.ru/files/1OLD.pdf"), false);
  assert.equal(isTrustedUgmuArtifactUrl("https://usma.ru/wp-content/uploads/2026/08/1OLD.xlsx"), false);
});
