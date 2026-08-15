import assert from "node:assert/strict";
import test from "node:test";
import { VkTokenManager, VK_TOKEN_MANAGER_CONFIG } from "../src/vk-token-manager.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("VK token manager preserves legacy static user token without touching vault", async () => {
  const manager = new VkTokenManager({
    vault: { enabled: false },
    env: { VK_USER_ACCESS_TOKEN: "legacy-user-token" },
    fetchImpl: async () => { throw new Error("unexpected_fetch"); },
  });
  assert.equal(manager.configured, true);
  assert.equal(manager.persistentOAuthEnabled, false);
  assert.equal(await manager.getAccessToken(), "legacy-user-token");
});

test("VK token manager returns a fresh encrypted-vault access token without refresh", async () => {
  let reads = 0;
  const vault = {
    enabled: true,
    async get() {
      reads += 1;
      return {
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        deviceId: "device",
        expiresAt: 2_000_000,
      };
    },
  };
  const manager = new VkTokenManager({
    vault,
    env: {},
    nowFactory: () => 1_000_000,
    fetchImpl: async () => { throw new Error("unexpected_fetch"); },
  });
  assert.equal(await manager.getAccessToken(), "fresh-access");
  assert.equal(reads, 1);
});

test("VK token manager refreshes expired access token, verifies state, and rotates stored credentials", async () => {
  const writes = [];
  const vault = {
    enabled: true,
    async get() {
      return {
        accessToken: "expired-access",
        refreshToken: "old-refresh",
        deviceId: "device-123",
        expiresAt: 1_000_001,
      };
    },
    async put(value) { writes.push(value); },
  };
  let requestUrl;
  let requestBody;
  const manager = new VkTokenManager({
    vault,
    env: {},
    nowFactory: () => 1_000_000,
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      requestBody = options.body;
      return response({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
        state: requestUrl.searchParams.get("state"),
        user_id: 77,
        scope: "wall groups",
      });
    },
  });

  assert.equal(await manager.getAccessToken(), "rotated-access");
  assert.equal(requestUrl.origin + requestUrl.pathname, VK_TOKEN_MANAGER_CONFIG.tokenUrl);
  assert.equal(requestUrl.searchParams.get("grant_type"), "refresh_token");
  assert.equal(requestUrl.searchParams.get("client_id"), String(VK_TOKEN_MANAGER_CONFIG.appId));
  assert.equal(requestUrl.searchParams.get("redirect_uri"), VK_TOKEN_MANAGER_CONFIG.redirectUrl);
  assert.equal(requestUrl.searchParams.get("device_id"), "device-123");
  assert.equal(requestBody.get("refresh_token"), "old-refresh");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].accessToken, "rotated-access");
  assert.equal(writes[0].refreshToken, "rotated-refresh");
  assert.equal(writes[0].deviceId, "device-123");
  assert.equal(writes[0].scope, "wall groups");
});

test("VK token manager fails closed on refresh state mismatch", async () => {
  const vault = {
    enabled: true,
    async get() {
      return {
        accessToken: "expired-access",
        refreshToken: "old-refresh",
        deviceId: "device-123",
        expiresAt: 1,
      };
    },
    async put() { throw new Error("unexpected_write"); },
  };
  const manager = new VkTokenManager({
    vault,
    env: {},
    nowFactory: () => 1_000_000,
    fetchImpl: async () => response({
      access_token: "bad-access",
      refresh_token: "bad-refresh",
      expires_in: 3600,
      state: "wrong-state",
    }),
  });
  await assert.rejects(() => manager.getAccessToken(), /vk_oauth_refresh_state_mismatch/);
});

test("VK token manager persists authorization result only when encrypted vault is enabled", async () => {
  const writes = [];
  const manager = new VkTokenManager({
    vault: { enabled: true, async put(value) { writes.push(value); } },
    env: {},
    nowFactory: () => 1_000_000,
  });
  const saved = await manager.saveAuthorizationResult({
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 3600,
    user_id: 42,
    scope: "wall groups",
  }, "device-42");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].accessToken, "new-access");
  assert.equal(writes[0].refreshToken, "new-refresh");
  assert.equal(saved.userId, 42);
  assert.equal(saved.scope, "wall groups");
});
