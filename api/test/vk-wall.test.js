import assert from "node:assert/strict";
import test from "node:test";
import { createVkWallHandler } from "../src/vk-wall.js";

function fakeRequest(method = "GET") {
  return { method };
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}

const env = {
  VK_CALLBACK_GROUP_ID: "191574528",
  VK_ACCESS_TOKEN: "vk1-community-test-token",
  VK_USER_ACCESS_TOKEN: "vk1-user-test-token",
  VK_API_VERSION: "5.199",
};

test("wall endpoint reads fixed community wall with the user token without exposing tokens", async () => {
  const requests = [];
  const response = fakeResponse();
  const handler = createVkWallHandler(env, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            response: {
              count: 1,
              items: [{
                id: 42,
                owner_id: -191574528,
                from_id: -191574528,
                date: 1786381200,
                text: "Тестовый пост",
                post_type: "post",
                is_pinned: 1,
                likes: { count: 7 },
                comments: { count: 2 },
                reposts: { count: 1 },
                views: { count: 100 },
                attachments: [{
                  type: "photo",
                  photo: {
                    id: 9,
                    owner_id: -191574528,
                    text: "Обложка",
                    sizes: [
                      { width: 100, height: 100, url: "https://example.test/small.jpg" },
                      { width: 1000, height: 800, url: "https://example.test/large.jpg" },
                    ],
                  },
                }],
              }],
            },
          };
        },
      };
    },
  });

  await handler(fakeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/wall.get");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.body.get("owner_id"), "-191574528");
  assert.equal(requests[0].options.body.get("count"), "20");
  assert.equal(requests[0].options.body.get("filter"), "owner");
  assert.equal(requests[0].options.body.get("access_token"), "vk1-user-test-token");
  assert.notEqual(requests[0].options.body.get("access_token"), env.VK_ACCESS_TOKEN);

  const body = JSON.parse(response.body);
  assert.equal(body.groupId, 191574528);
  assert.equal(body.total, 1);
  assert.equal(body.count, 1);
  assert.equal(body.posts[0].id, 42);
  assert.equal(body.posts[0].text, "Тестовый пост");
  assert.equal(body.posts[0].isPinned, true);
  assert.equal(body.posts[0].likes, 7);
  assert.equal(body.posts[0].attachments[0].imageUrl, "https://example.test/large.jpg");
  assert.equal(response.body.includes("vk1-user-test-token"), false);
  assert.equal(response.body.includes("vk1-community-test-token"), false);
  assert.equal(response.headers["Cache-Control"], "public, max-age=60");
});

test("wall endpoint rejects mutation methods", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = createVkWallHandler(env, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
  });

  await handler(fakeRequest("POST"), response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "method_not_allowed" });
  assert.equal(fetchCalls, 0);
});

test("wall endpoint fails closed when only the community token is configured", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = createVkWallHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "vk1-community-test-token",
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_wall_not_configured" });
  assert.equal(fetchCalls, 0);
});

test("VK API error is sanitized", async () => {
  const response = fakeResponse();
  const handler = createVkWallHandler(env, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { error: { error_code: 5, error_msg: "auth failed" } };
      },
    }),
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_wall_unavailable" });
  assert.equal(response.body.includes("auth failed"), false);
});
