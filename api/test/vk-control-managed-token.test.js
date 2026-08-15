import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-15T20:30:00.000Z");

function fakeRequest() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "cmd-wall-list-managed-0001",
        action: "wall.list",
        createdAt: "2026-08-15T20:29:00.000Z",
        payload: {},
      }));
    },
  };
}

function fakeResponse() {
  return {
    statusCode: null,
    body: "",
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = "") { this.body = String(body); },
  };
}

test("VK control uses managed OAuth token without static VK_USER_ACCESS_TOKEN", async () => {
  let tokenCalls = 0;
  let vkToken = null;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token-must-not-be-used",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() {
        tokenCalls += 1;
        return "managed-user-token";
      },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async (_url, options) => {
      vkToken = options.body.get("access_token");
      return {
        ok: true,
        async json() { return { response: { count: 0, items: [] } }; },
      };
    },
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(tokenCalls, 1);
  assert.equal(vkToken, "managed-user-token");
  assert.notEqual(vkToken, "community-token-must-not-be-used");
});

test("VK control fails closed when managed credentials are missing", async () => {
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() { throw new Error("vk_oauth_credentials_missing"); },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async () => { throw new Error("VK must not be called"); },
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
});
