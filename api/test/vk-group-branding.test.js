import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T20:50:00.000Z");

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
