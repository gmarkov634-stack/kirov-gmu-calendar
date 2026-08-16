import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T21:40:00.000Z");
const sourceUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-cover-independent-1590x530-20260816.jpg";

function request() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "branding-cover-probe-0001",
        action: "group.cover.probe",
        createdAt: "2026-08-16T21:39:00.000Z",
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

test("group.cover.probe uploads but never calls saveOwnerCoverPhoto or managed token", async () => {
  let managedCalls = 0;
  const methods = [];
  const out = response();
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
        managedCalls += 1;
        return "managed-token-must-not-be-used";
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
      if (value === "https://pu.vk.com/cover-probe") {
        assert.equal(options.method, "POST");
        return {
          ok: true,
          async json() {
            return { hash: "secret-hash-must-not-leak", photo: "{\"crop\":true}" };
          },
        };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        methods.push(method);
        assert.equal(options.body.get("access_token"), "community-token");
        assert.equal(method, "photos.getOwnerCoverPhotoUploadServer");
        return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.com/cover-probe" } }; } };
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(request(), out);
  assert.equal(out.statusCode, 200);
  assert.equal(managedCalls, 0);
  assert.deepEqual(methods, ["photos.getOwnerCoverPhotoUploadServer"]);
  const body = JSON.parse(out.body);
  assert.equal(body.result.saved, false);
  assert.deepEqual(body.result.upload.uploadKeys, ["hash", "photo"]);
  assert.equal(body.result.upload.photoKind, "string");
  assert.equal(body.result.upload.photoStartsWithBrace, true);
  assert.equal(body.result.upload.parsedPhotoKind, "object");
  assert.equal(body.result.upload.hashLength, "secret-hash-must-not-leak".length);
  assert.doesNotMatch(out.body, /secret-hash-must-not-leak/);
});
