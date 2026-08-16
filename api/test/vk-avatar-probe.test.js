import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T22:40:00.000Z");
const sourceUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-avatar-independent-20260816.jpg";

function fakeRequest() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "vk-avatar-probe-test-0001",
        action: "group.avatar.probe",
        createdAt: "2026-08-16T22:39:00.000Z",
        payload: { sourceUrl },
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

test("group.avatar.probe uses managed user token, uploads avatar, and never saves it", async () => {
  let managedTokenCalls = 0;
  const apiMethods = [];
  let uploadCalls = 0;
  const response = fakeResponse();
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
      if (value === "https://pu.vk.com/avatar-probe") {
        uploadCalls += 1;
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        assert.ok(options.body.get("photo") instanceof Blob);
        assert.equal(options.body.get("file"), null);
        return {
          ok: true,
          async json() {
            return { server: 321, hash: "avatar-hash", photo: "opaque-avatar-photo" };
          },
        };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        apiMethods.push(method);
        assert.equal(options.body.get("access_token"), "managed-user-token");
        assert.equal(method, "photos.getOwnerPhotoUploadServer");
        assert.equal(options.body.get("owner_id"), "-191574528");
        return {
          ok: true,
          async json() {
            return { response: { upload_url: "https://pu.vk.com/avatar-probe" } };
          },
        };
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(fakeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 1);
  assert.equal(uploadCalls, 1);
  assert.deepEqual(apiMethods, ["photos.getOwnerPhotoUploadServer"]);
  const body = JSON.parse(response.body);
  assert.equal(body.result.saved, false);
  assert.deepEqual(body.result.upload, {
    uploadKeys: ["hash", "photo", "server"],
    photoKind: "string",
    photoStringLength: 19,
    photoStartsWithBrace: false,
    photoStartsWithBracket: false,
    parsedPhotoKind: "not_json",
    photoObjectKeys: [],
    firstArrayItemKeys: [],
    hashKind: "string",
    hashLength: 11,
    serverKind: "number",
    serverPresent: true,
  });
});

test("group.avatar.probe fails closed without a user credential and never uses community token", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token",
    VK_API_VERSION: "5.199",
  }, {
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
  });

  await handler(fakeRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
});
