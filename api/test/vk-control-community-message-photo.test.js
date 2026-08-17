import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T14:35:00.000Z");
const sourceUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/53cd2dbac2ab09a9bcb66dcd5d6c9fb70a959e8c/ops/vk/assets/post66-study-day-approved-20260816.jpg";

function fakeRequest(command) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(command)); },
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

function command() {
  return {
    id: "vk-photo-community-message-test-0001",
    action: "photo.importMessages",
    createdAt: "2026-08-16T14:34:00.000Z",
    payload: { sourceUrl },
  };
}

test("photo.importMessages uses only community token and returns a wall-compatible photo attachment", async () => {
  let managedTokenCalls = 0;
  const apiMethods = [];
  let uploadCalls = 0;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token",
    VK_API_VERSION: "5.199",
  }, {
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token-must-not-be-used";
      },
    },
    fetchImpl: async (url, options = {}) => {
      const value = String(url);
      if (value === sourceUrl) {
        return {
          ok: true,
          headers: { get: () => "image/jpeg" },
          async arrayBuffer() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer; },
        };
      }
      if (value === "https://pu.vk.com/upload-message-photo") {
        uploadCalls += 1;
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        return {
          ok: true,
          async json() { return { server: 123, photo: "[]", hash: "upload-hash" }; },
        };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        apiMethods.push(method);
        assert.equal(options.body.get("access_token"), "community-token");
        if (method === "photos.getMessagesUploadServer") {
          return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.com/upload-message-photo" } }; } };
        }
        if (method === "photos.saveMessagesPhoto") {
          assert.equal(options.body.get("server"), "123");
          assert.equal(options.body.get("photo"), "[]");
          assert.equal(options.body.get("hash"), "upload-hash");
          return {
            ok: true,
            async json() {
              return { response: [{
                id: 777,
                owner_id: -191574528,
                access_key: "safe_access_key",
                sizes: [{ width: 1200, height: 1200, url: "https://sun.vk.com/photo.jpg" }],
              }] };
            },
          };
        }
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(fakeRequest(command()), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.equal(uploadCalls, 1);
  assert.deepEqual(apiMethods, ["photos.getMessagesUploadServer", "photos.saveMessagesPhoto"]);
  assert.deepEqual(JSON.parse(response.body).result, {
    attachment: "photo-191574528_777_safe_access_key",
    photo: { id: 777, ownerId: -191574528, imageUrl: "https://sun.vk.com/photo.jpg" },
  });
});

test("photo.importMessages fails closed without community token and never requests managed token", async () => {
  let managedTokenCalls = 0;
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_API_VERSION: "5.199",
  }, {
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token";
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest(command()), response);

  assert.equal(response.statusCode, 503);
  assert.equal(managedTokenCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
});
