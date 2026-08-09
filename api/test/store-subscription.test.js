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

test("access monitor marks many recent sources and revocation clears the cached subscription", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-access-"));
  try {
    const store = new ScheduleStore({ dataDir, cacheTtlMs: 300000, suspiciousSourceThreshold: 3 });
    const token = "m".repeat(43);
    const subscription = { version: 1, status: "active", group: "133", orderId: "o".repeat(32) };
    await store.putSubscription(token, subscription);
    for (let index = 0; index < 3; index += 1) {
      await store.recordSubscriptionAccess(token, subscription, {
        fingerprint: String(index).repeat(64),
        client: "other",
        seenAt: `2026-08-0${index + 7}T12:00:00.000Z`,
      });
    }
    const [record] = await store.listSubscriptionAccess();
    assert.equal(record.sourceCount, 3);
    assert.equal(record.suspicious, true);
    await store.revokeSubscriptionByHash(createHash("sha256").update(token).digest("hex"));
    assert.equal((await store.getSubscription(token)).status, "revoked");
    assert.equal((await store.listSubscriptionAccess())[0].status, "revoked");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
