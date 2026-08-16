import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T20:50:00.000Z");
const coverUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-cover-independent-1590x530-20260816.jpg";
const avatarUrl = "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-avatar-independent-20260816.jpg";

function fakeRequest(action, payload = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: `branding-${action.replaceAll(".", "-")}-0001`,
        action,
        createdAt: "2026-08-16T20:49:00.000Z",
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
  return {
    ok: true,
    headers: { get: () => "image/jpeg" },
    async arrayBuffer() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer; },
  };
}

test("group.cover.set uses community token, cover file multipart field, normalized centered crop, and response_json save", async () => {
  let managedTokenCalls = 0;
  const methods = [];
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
        return "managed-token-must-not-be-used";
      },
    },
    fetchImpl: async (url, options = {}) => {
      const value = String(url);
      if (value === coverUrl) return jpegResponse();
      if (value === "https://pu.vk.com/group-cover") {
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        assert.ok(options.body.get("file") instanceof Blob);
        assert.equal(options.body.get("photo"), null);
        return { ok: true, async json() { return { hash: "cover-hash", photo: "cover-photo" }; } };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        methods.push(method);
        assert.equal(options.body.get("access_token"), "community-token");
        if (method === "photos.getOwnerCoverPhotoUploadServer") {
          assert.equal(options.body.get("group_id"), "191574528");
          assert.equal(options.body.get("crop_x"), "0");
          assert.equal(options.body.get("crop_y"), "32");
          assert.equal(options.body.get("crop_x2"), "795");
          assert.equal(options.body.get("crop_y2"), "232");
          return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.com/group-cover" } }; } };
        }
        if (method === "photos.saveOwnerCoverPhoto") {
          assert.equal(options.body.get("hash"), null);
          assert.equal(options.body.get("photo"), null);
          assert.equal(options.body.get("response_json"), JSON.stringify({ hash: "cover-hash", photo: "cover-photo" }));
          return {
            ok: true,
            async json() {
              return { response: { images: [{ url: "https://sun.vk.com/cover.jpg", width: 1590, height: 400 }] } };
            },
          };
        }
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(fakeRequest("group.cover.set", { sourceUrl: coverUrl }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.deepEqual(methods, ["photos.getOwnerCoverPhotoUploadServer", "photos.saveOwnerCoverPhoto"]);
  assert.deepEqual(JSON.parse(response.body).result, {
    updated: true,
    images: [{ url: "https://sun.vk.com/cover.jpg", width: 1590, height: 400 }],
  });
});

test("group.avatar.set uses managed user token only and keeps photo multipart field", async () => {
  let managedTokenCalls = 0;
  const methods = [];
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
      if (value === avatarUrl) return jpegResponse();
      if (value === "https://pu.vk.com/group-avatar") {
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        assert.ok(options.body.get("photo") instanceof Blob);
        assert.equal(options.body.get("file"), null);
        return { ok: true, async json() { return { server: 321, hash: "avatar-hash", photo: "avatar-photo" }; } };
      }
      if (value.startsWith("https://api.vk.com/method/")) {
        const method = value.slice("https://api.vk.com/method/".length);
        methods.push(method);
        assert.equal(options.body.get("access_token"), "managed-user-token");
        if (method === "photos.getOwnerPhotoUploadServer") {
          assert.equal(options.body.get("owner_id"), "-191574528");
          return { ok: true, async json() { return { response: { upload_url: "https://pu.vk.com/group-avatar" } }; } };
        }
        if (method === "photos.saveOwnerPhoto") {
          assert.equal(options.body.get("server"), "321");
          assert.equal(options.body.get("hash"), "avatar-hash");
          assert.equal(options.body.get("photo"), "avatar-photo");
          return {
            ok: true,
            async json() {
              return { response: { saved: 1, photo_src_big: "https://sun.vk.com/avatar.jpg" } };
            },
          };
        }
      }
      throw new Error(`unexpected fetch ${value}`);
    },
  });

  await handler(fakeRequest("group.avatar.set", { sourceUrl: avatarUrl }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 1);
  assert.deepEqual(methods, ["photos.getOwnerPhotoUploadServer", "photos.saveOwnerPhoto"]);
  assert.deepEqual(JSON.parse(response.body).result, {
    updated: true,
    photoUrl: "https://sun.vk.com/avatar.jpg",
    postId: null,
  });
});

test("group.avatar.set never falls back to community token when user credential is absent", async () => {
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
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest("group.avatar.set", { sourceUrl: avatarUrl }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
});

test("group.branding.info is read-only and returns only avatar and cover fields", async () => {
  let managedTokenCalls = 0;
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
        return "managed-token-must-not-be-used";
      },
    },
    fetchImpl: async (url, options = {}) => {
      assert.equal(String(url), "https://api.vk.com/method/groups.getById");
      assert.equal(options.body.get("access_token"), "community-token");
      assert.match(options.body.get("fields"), /cover/);
      return {
        ok: true,
        async json() {
          return {
            response: {
              groups: [{
                id: 191574528,
                photo_200: "https://sun.vk.com/a200.jpg",
                photo_400: "https://sun.vk.com/a400.jpg",
                photo_max_orig: "https://sun.vk.com/amax.jpg",
                cover: {
                  enabled: 1,
                  images: [{ url: "https://sun.vk.com/c1590.jpg", width: 1590, height: 400 }],
                },
                admin_level: 3,
              }],
            },
          };
        },
      };
    },
  });

  await handler(fakeRequest("group.branding.info"), response);
  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.deepEqual(JSON.parse(response.body).result, {
    id: 191574528,
    photo200: "https://sun.vk.com/a200.jpg",
    photo400: "https://sun.vk.com/a400.jpg",
    photoMax: "https://sun.vk.com/amax.jpg",
    cover: {
      enabled: true,
      images: [{ url: "https://sun.vk.com/c1590.jpg", width: 1590, height: 400 }],
    },
  });
});
