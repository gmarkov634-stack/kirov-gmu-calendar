import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-15T21:55:00.000Z");

function fakeRequest() {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "cmd-group-info-0001",
        action: "group.info",
        createdAt: "2026-08-15T21:54:00.000Z",
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

test("group.info reads fixed community metadata with community token and sanitizes output", async () => {
  const requests = [];
  let managedTokenCalls = 0;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token",
    VK_USER_ACCESS_TOKEN: "legacy-user-token-must-not-be-used",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token-must-not-be-used";
      },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            response: {
              groups: [{
                id: 191574528,
                name: "Календарь КГМУ",
                screen_name: "calendarksmu",
                type: "group",
                is_closed: 0,
                description: "Описание сообщества",
                site: "https://example.test",
                activity: "Образование",
                status: "Тестовый статус",
                members_count: 42,
                verified: 0,
                city: { id: 1, title: "Киров" },
                country: { id: 1, title: "Россия" },
                admin_level: 3,
              }],
            },
          };
        },
      };
    },
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/groups.getById");
  assert.equal(requests[0].options.body.get("group_ids"), "191574528");
  assert.equal(requests[0].options.body.get("access_token"), "community-token");
  assert.match(requests[0].options.body.get("fields"), /description/);

  const body = JSON.parse(response.body);
  assert.deepEqual(body.result, {
    id: 191574528,
    name: "Календарь КГМУ",
    screenName: "calendarksmu",
    type: "group",
    isClosed: 0,
    description: "Описание сообщества",
    website: "https://example.test",
    activity: "Образование",
    status: "Тестовый статус",
    membersCount: 42,
    verified: false,
    city: { id: 1, title: "Киров" },
    country: { id: 1, title: "Россия" },
  });
  assert.equal(Object.hasOwn(body.result, "admin_level"), false);
});

test("group.info fails closed when community token is absent", async () => {
  let vkCalls = 0;
  let managedTokenCalls = 0;
  const response = fakeResponse();
  const handler = createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
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
    fetchImpl: async () => {
      vkCalls += 1;
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest(), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
  assert.equal(managedTokenCalls, 0);
  assert.equal(vkCalls, 0);
});
