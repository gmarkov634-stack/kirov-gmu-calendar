import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pagesV2 = fs.readFileSync(new URL("../../.github/workflows/ugmu-controlled-pages-main-v2.yml", import.meta.url), "utf8");
const pagesLegacy = fs.readFileSync(new URL("../../.github/workflows/ugmu-controlled-pages-main.yml", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../ugmu/app.js", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../../ugmu/config.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../ugmu/index.html", import.meta.url), "utf8");

test("UGMU Pages v2 publishes the canonical trial landing", () => {
  assert.match(pagesV2, /cp -R feature\/ugmu\/\. dist\/site\/ugmu\//);
  assert.doesNotMatch(pagesV2, /feature\/site\/ugmu/);
  assert.match(pagesV2, /- "ugmu\/\*\*"/);
  assert.match(pagesV2, /source="\$GITHUB_SHA"/);
  assert.match(pagesV2, /meta\.universityTrials\?\.ugmu === "open"/);
  assert.match(pagesV2, /\/api\/v2\/trials/);
  assert.match(pagesV2, /id=\\"trial-start\\"/);
  assert.match(pagesV2, /trial-ui=present/);
});

test("legacy UGMU Pages workflow cannot race the canonical push deploy", () => {
  assert.match(pagesLegacy, /workflow_dispatch:/);
  assert.doesNotMatch(pagesLegacy, /\n\s*push:/);
  assert.match(pagesLegacy, /cp -R feature\/ugmu\/\. dist\/site\/ugmu\//);
  assert.doesNotMatch(pagesLegacy, /feature\/site\/ugmu/);
  assert.match(pagesLegacy, /meta\.universityTrials\?\.ugmu === "open"/);
});

test("canonical UGMU landing retains fail-closed trial authorization", () => {
  assert.match(app, /runtime\.trial = meta\.universityTrials\?\.ugmu === "open" \? "open" : "closed"/);
  assert.doesNotMatch(app, /meta\.trials\s*===\s*"open"/);
  assert.match(config, /trialPath:\s*"\/api\/v2\/trials"/);
  assert.match(config, /trialDays:\s*7/);
  assert.match(html, /id="trial-start"/);
  assert.match(html, /Попробовать бесплатно/);
});
