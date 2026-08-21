import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TrialEnabledStore } from "../src/trial-store.js";

const CLAIM_HASH = "a".repeat(64);

async function withStore(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "trial-claim-"));
  const store = new TrialEnabledStore({
    dataDir,
    accessKeyId: "",
    secretAccessKey: "",
  });
  try {
    await run(store, dataDir);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

test("local trial identity claim is atomic under concurrent requests", async () => {
  await withStore(async (store, dataDir) => {
    const record = {
      version: 1,
      policy: "one-anonymous-trial-per-university-semester",
      university: "ugmu",
      academicYear: "2026/2027",
      semester: 1,
      createdAt: "2026-08-21T15:00:00.000Z",
    };

    const results = await Promise.all(
      Array.from({ length: 24 }, () => store.claimTrialIdentityByHash(CLAIM_HASH, record)),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.filter((value) => value === false).length, 23);

    const filename = path.join(dataDir, "trial-identity-claims", `${CLAIM_HASH}.json`);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, "utf8")), record);
  });
});

test("S3 trial identity claim uses conditional object creation", async () => {
  const store = new TrialEnabledStore({
    dataDir: "/unused",
    bucket: "test-bucket",
    accessKeyId: "",
    secretAccessKey: "",
  });
  let input;
  store.s3 = { async send(command) { input = command.input; return {}; } };
  assert.equal(await store.claimTrialIdentityByHash(CLAIM_HASH, { version: 1 }), true);
  assert.equal(input.Bucket, "test-bucket");
  assert.equal(input.Key, `trial-identity-claims/${CLAIM_HASH}.json`);
  assert.equal(input.IfNoneMatch, "*");
});

test("S3 conditional claim conflict is treated as an existing identity", async () => {
  const store = new TrialEnabledStore({
    dataDir: "/unused",
    bucket: "test-bucket",
    accessKeyId: "",
    secretAccessKey: "",
  });
  store.s3 = { async send() { const error = new Error("precondition"); error.$metadata = { httpStatusCode: 412 }; throw error; } };
  assert.equal(await store.claimTrialIdentityByHash(CLAIM_HASH, { version: 1 }), false);
});

test("trial identity claim rejects unsafe storage keys", async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.claimTrialIdentityByHash("../escape", {}),
      /Invalid trial identity claim hash/,
    );
  });
});
