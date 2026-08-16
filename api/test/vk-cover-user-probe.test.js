import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T22:02:00.000Z");
const sourceUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-cover-independent-1590x530-20260816.jpg";

function request() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "vk-cover-user-probe-test-001",
        action: "group.cover.userProbe",
        createdAt: "2026-08-16T22:01:00.000Z",
        payload: { sourceUrl },
      }));
    },
  };
}

function response() {
  return {
    statusCode: null,
    body: "",
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = "") { this.body = String(body); },
  };
}

test("group.cover.userProbe uses managed user token and never calls saveOwnerCoverPhoto", async () => {
  let managedTokenCalls = 0;
  const methods = [];
  const out = response();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token-must-not-be-used",
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
    fetchImpl: async (url, options = {}) => {
      const value = String(url);
      if (value === sourceUrl) {
        return {
          ok: true,
          headers: { get: () => "image/jpeg" },
          async arrayBuffer() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer; },
        };
      }
      if (value === "https://pu.vk.com/user-cover-probe") {
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        assert.ok(options.body.get("file") instanceof Blob);
        return { ok: true, async json() { return { hash: "probe-hash", photo: "opaque-photo" }; } };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        methods.push(method);
        assert.equal(options.body.get("access_token"), "managed-user-token");
        assert.equal(method, "photos.getOwnerCoverPhotoUploadServer");
        return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.com/user-cover-probe" } }; } };
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(request(), out);

  assert.equal(out.statusCode, 200);
  assert.equal(managedTokenCalls, 1);
  assert.deepEqual(methods, ["photos.getOwnerCoverPhotoUploadServer"]);
  const body = JSON.parse(out.body);
  assert.equal(body.result.saved, false);
  assert.deepEqual(body.result.upload.uploadKeys, ["hash", "photo"]);
});
