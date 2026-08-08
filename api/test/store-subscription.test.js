import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ScheduleStore } from "../src/store.js";

test("local subscription store resolves a token through its SHA-256 filename", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-subscription-"));
  try {
    const token = "t".repeat(43);
    const hash = createHash("sha256").update(token).digest("hex");
    const directory = path.join(dataDir, "subscriptions");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, `${hash}.json`), JSON.stringify({ version: 1, group: "132" }));

    const store = new ScheduleStore({ dataDir, cacheTtlMs: 300000 });
    assert.deepEqual(await store.getSubscription(token), { version: 1, group: "132" });
    assert.equal(await store.getSubscription("not-a-valid-token"), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("local store persists private orders and generated subscriptions", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-orders-"));
  try {
    const store = new ScheduleStore({ dataDir, cacheTtlMs: 300000 });
    const orderId = "o".repeat(32);
    const token = "s".repeat(43);
    await store.putOrder(orderId, { status: "pending" });
    await store.putSubscription(token, { version: 1, group: "132" });
    assert.deepEqual(await store.getOrder(orderId), { status: "pending" });
    assert.deepEqual(await store.getSubscription(token), { version: 1, group: "132" });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
