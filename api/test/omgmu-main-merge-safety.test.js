import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("OmGMU enters main inactive with every launch gate and server watcher fail-closed", () => {
  const university = getUniversityConfig("omgmu");
  const config = loadConfig({});

  assert.equal(university.active, false);
  assert.equal(config.omgmuWatchEnabled, false);
  assert.equal(config.commercialSalesEnabled, false);
  assert.equal(config.trialsEnabled, false);
  assert.equal(config.funnelAnalyticsEnabled, false);
});

test("server starts OmGMU observation only behind the explicit watcher gate", () => {
  const server = readRepo("api/src/server.js");
  assert.match(server, /if \(config\.omgmuWatchEnabled\) \{/);
  assert.match(server, /OMGMU source watcher enabled:[^\n]+observation\/review only/);
  assert.doesNotMatch(server, /\/api\/v1\/admin\/omgmu\/[^"'\n]*publish/);
});

test("server exposes only a read-only OmGMU watcher status surface", () => {
  const server = readRepo("api/src/server.js");
  const statusHandler = readRepo("api/src/omgmu-watch-status.js");

  assert.match(server, /createOmgmuWatchStatusHandler/);
  assert.match(server, /\/api\/v2\/status\/omgmu-watcher/);
  assert.match(statusHandler, /request\.method !== "GET"/);
  assert.match(statusHandler, /publicationMode: "explicit-only"/);
  assert.doesNotMatch(statusHandler, /publishScheduleBatch|review\.publish|review\.submit_publish/);
});

test("scheduled OmGMU source watch is read-only and cannot publish", () => {
  const workflow = readRepo(".github/workflows/omgmu-source-watch.yml");

  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /publishScheduleBatch|schedule-review\/control|ADMIN_TOKEN|S3_SECRET_ACCESS_KEY|S3_ACCESS_KEY_ID/);
  assert.match(workflow, /Upload newly active PDFs/);
});

test("legacy direct-S3 publication is absent from actions and package commands", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, ".github/workflows/omgmu-publish-s3.yml")), false);

  const packageJson = JSON.parse(readRepo("api/package.json"));
  assert.equal(Object.hasOwn(packageJson.scripts || {}, "publish:omgmu:s3"), false);
  assert.equal(packageJson.scripts?.["debug:omgmu:legacy-s3-plan"], "node tools/omgmu-publish-s3.mjs");

  const legacyTool = readRepo("api/tools/omgmu-publish-s3.mjs");
  assert.match(legacyTool, /OMG_LEGACY_DIRECT_PUBLICATION_RETIRED/);
  assert.doesNotMatch(legacyTool, /PutObjectCommand|DeleteObjectCommand|S3Client/);
});

test("OmGMU landing has no static sellable catalog or local launch authority", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "site/omgmu/groups.js")), false);

  const config = readRepo("site/omgmu/config.js");
  const app = readRepo("site/omgmu/app.js");
  const html = readRepo("site/omgmu/index.html");

  for (const marker of ["checkoutEnabled", "testMode", "priceRub"]) {
    assert.doesNotMatch(config, new RegExp(marker));
  }
  assert.doesNotMatch(app, /window\.OMGMU_GROUPS|config\.testMode|config\.priceRub/);
  assert.match(app, /\/api\/v2\/meta/);
  assert.match(app, /\/api\/v2\/catalog\//);
  assert.match(app, /runtime\.sales === ['"]open['"]/);
  assert.match(html, /type="submit" disabled/);
});
