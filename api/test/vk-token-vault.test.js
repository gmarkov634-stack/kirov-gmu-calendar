import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VkTokenVault, VK_TOKEN_VAULT_STORAGE_KEY } from "../src/vk-token-vault.js";

function config(dataDir) {
  return {
    dataDir,
    accessKeyId: "",
    secretAccessKey: "",
    endpoint: "https://s3.cloud.ru",
    region: "ru-central-1",
    bucket: "test",
  };
}

const credentials = {
  accessToken: "vk-access-sensitive",
  refreshToken: "vk-refresh-sensitive",
  deviceId: "device-sensitive",
  expiresAt: Date.now() + 3600000,
  userId: 123,
  scope: "wall groups",
  obtainedAt: new Date().toISOString(),
};

test("VK token vault encrypts credentials at rest and decrypts them with the same key", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-vault-"));
  const key = Buffer.alloc(32, 7).toString("base64url");
  const vault = new VkTokenVault(config(dataDir), { encryptionKey: key });

  await vault.put(credentials);
  const raw = await fs.readFile(path.join(dataDir, VK_TOKEN_VAULT_STORAGE_KEY), "utf8");
  assert.equal(raw.includes(credentials.accessToken), false);
  assert.equal(raw.includes(credentials.refreshToken), false);
  assert.equal(raw.includes(credentials.deviceId), false);
  assert.match(raw, /"alg":"A256GCM"/);

  const restored = await vault.get();
  assert.equal(restored.accessToken, credentials.accessToken);
  assert.equal(restored.refreshToken, credentials.refreshToken);
  assert.equal(restored.deviceId, credentials.deviceId);
  assert.equal(restored.scope, "wall groups");
});

test("VK token vault fails closed when encryption key is absent", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-vault-disabled-"));
  const vault = new VkTokenVault(config(dataDir), { encryptionKey: "" });
  assert.equal(vault.enabled, false);
  await assert.rejects(() => vault.put(credentials), /vk_oauth_vault_not_configured/);
  await assert.rejects(() => vault.get(), /vk_oauth_vault_not_configured/);
});

test("VK token vault cannot decrypt with a different key", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-vault-key-"));
  const first = new VkTokenVault(config(dataDir), { encryptionKey: Buffer.alloc(32, 1).toString("base64url") });
  const second = new VkTokenVault(config(dataDir), { encryptionKey: Buffer.alloc(32, 2).toString("base64url") });
  await first.put(credentials);
  await assert.rejects(() => second.get(), /vk_oauth_vault_decrypt_failed/);
});
