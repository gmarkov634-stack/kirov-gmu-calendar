import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(apiRoot, relativePath), "utf8");
}

test("legacy ОмГМУ S3 tool has no write/delete capability and rejects --confirm", () => {
  const source = read("tools/omgmu-publish-s3.mjs");
  assert.doesNotMatch(source, /PutObjectCommand|DeleteObjectCommand|HeadObjectCommand|S3Client/);
  assert.match(source, /OMG_LEGACY_DIRECT_PUBLICATION_RETIRED/);
  assert.match(source, /process\.argv\.includes\("--confirm"\)/);
  assert.match(source, /canonicalEntrypoint:\s*"publishScheduleBatch"/);
  assert.match(source, /directPublicationEnabled:\s*false/);
});

test("package exposes legacy S3 inspection only as debug plan, never as publish command", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["publish:omgmu:s3"], undefined);
  assert.equal(pkg.scripts["debug:omgmu:legacy-s3-plan"], "node tools/omgmu-publish-s3.mjs");
});

test("shared canonical publication entrypoint remains publishScheduleBatch with store get/put boundary", () => {
  const pipeline = read("src/schedule/pipeline.js");
  assert.match(pipeline, /export async function publishScheduleBatch/);
  assert.match(pipeline, /store\.getSchedule/);
  assert.match(pipeline, /store\.putSchedule\(prepared\.batch\)/);
  assert.match(pipeline, /prepareSchedulePublication\(incomingBatch/);
});
