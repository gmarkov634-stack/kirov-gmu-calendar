import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

// Production flow: managed user token imports the photo; community token publishes it with wall.post.
const now = Date.parse("2026-08-16T08:30:00.000Z");

function fakeRequest(payload, action = "photo.importWall") {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "cmd-photo-import-0001",
        action,
        createdAt: "2026-08-16T08:29:00.000Z",
        payload,
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

function jpegResponse() {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);
  return {
    ok: true,
    headers: { get(name) { return String(name).toLowerCase() === "content-type" ? "image/jpeg" : null; } },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test("photo.importWall uses managed user token, uploads fixed group wall photo and returns attachment", async () => {
  const requests = [];
  let managedTokenCalls = 0;
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token-must-not-be-used",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token";
      },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("https://raw.githubusercontent.com/")) return jpegResponse();
      if (url === "https://api.vk.com/method/photos.getWallUploadServer") {
        assert.equal(options.body.get("access_token"), "managed-user-token");
        assert.equal(options.body.get("group_id"), "191574528");
        return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.test/upload" } }; } };
      }
      if (url === "https://pu.vk.test/upload") {
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        return { ok: true, async json() { return { server: 123, photo: "[{\"photo\":\"x\"}]", hash: "upload-hash" }; } };
      }
      if (url === "https://api.vk.com/method/photos.saveWallPhoto") {
        assert.equal(options.body.get("access_token"), "managed-user-token");
        assert.equal(options.body.get("group_id"), "191574528");
        assert.equal(options.body.get("server"), "123");
        assert.equal(options.body.get("hash"), "upload-hash");
        return {
          ok: true,
          async json() {
            return { response: [{ id: 777, owner_id: -191574528, sizes: [{ width: 100, height: 100, url: "https://img.test/777.jpg" }] }] };
          },
        };
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const response = fakeResponse();
  await handler(fakeRequest({
    sourceUrl: "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/post66.jpg",
  }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 1);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.result, {
    attachment: "photo-191574528_777",
    photo: { id: 777, ownerId: -191574528, imageUrl: "https://img.test/777.jpg" },
  });
  assert.equal(requests.length, 4);
});

test("photo.importWall rejects non-allowlisted source before token-dependent VK work", async () => {
  let vkCalls = 0;
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_USER_ACCESS_TOKEN: "legacy-user-token",
    VK_API_VERSION: "5.199",
  }, {
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async () => {
      vkCalls += 1;
      throw new Error("network must not be used");
    },
  });
  const response = fakeResponse();
  await handler(fakeRequest({ sourceUrl: "https://example.com/post.jpg" }), response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_photo_source_url" });
  assert.equal(vkCalls, 0);
});
