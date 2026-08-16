import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-17T00:15:00.000Z");

function fakeRequest(action, payload = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: `cmd-${action.replaceAll(".", "-")}-0001`,
        action,
        createdAt: "2026-08-17T00:14:00.000Z",
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

function makeHandler({ fetchImpl, tokenManager, communityToken = "community-token" } = {}) {
  return createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: communityToken,
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: tokenManager || {
      configured: true,
      async getAccessToken() { return "managed-user-token"; },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl,
  });
}

test("group.links.list reads sanitized links with the community token", async () => {
  const requests = [];
  let managedCalls = 0;
  const handler = makeHandler({
    tokenManager: {
      configured: true,
      async getAccessToken() { managedCalls += 1; return "managed-user-token"; },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { response: { groups: [{
            id: 191574528,
            links: [{ id: 7, name: "Выбрать группу", desc: "Календарь", url: "https://example.test/#selector", photo_50: "https://img.test/50.jpg" }],
          }] } };
        },
      };
    },
  });
  const response = fakeResponse();
  await handler(fakeRequest("group.links.list"), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/groups.getById");
  assert.equal(requests[0].options.body.get("access_token"), "community-token");
  assert.equal(requests[0].options.body.get("fields"), "links");
  assert.deepEqual(JSON.parse(response.body).result.links[0], {
    id: 7,
    name: "Выбрать группу",
    description: "Календарь",
    url: "https://example.test/#selector",
    photo50: "https://img.test/50.jpg",
    photo100: null,
  });
});

test("group.link.add uses only the managed user token", async () => {
  const requests = [];
  let managedCalls = 0;
  const handler = makeHandler({
    tokenManager: {
      configured: true,
      async getAccessToken() { managedCalls += 1; return "managed-user-token"; },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { response: { id: 8, name: "Выбрать группу", desc: "Открыть выбор группы", url: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/#selector" } };
        },
      };
    },
  });
  const response = fakeResponse();
  await handler(fakeRequest("group.link.add", {
    url: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/#selector",
    text: "Выбрать группу",
  }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/groups.addLink");
  assert.equal(requests[0].options.body.get("access_token"), "managed-user-token");
  assert.equal(requests[0].options.body.get("group_id"), "191574528");
  assert.equal(requests[0].options.body.get("link"), "https://gmarkov634-stack.github.io/kirov-gmu-calendar/#selector");
  assert.equal(requests[0].options.body.get("text"), "Выбрать группу");
});

test("group.link.add rejects non-HTTPS URLs before token lookup or network", async () => {
  let managedCalls = 0;
  let vkCalls = 0;
  const handler = makeHandler({
    tokenManager: {
      configured: true,
      async getAccessToken() { managedCalls += 1; return "managed-user-token"; },
    },
    fetchImpl: async () => { vkCalls += 1; throw new Error("unexpected VK call"); },
  });
  const response = fakeResponse();
  await handler(fakeRequest("group.link.add", { url: "http://example.test/", text: "Bad" }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_group_link_url" });
  assert.equal(managedCalls, 1);
  assert.equal(vkCalls, 0);
});

test("group.link.delete validates link id", async () => {
  let vkCalls = 0;
  const handler = makeHandler({
    fetchImpl: async () => { vkCalls += 1; throw new Error("unexpected VK call"); },
  });
  const response = fakeResponse();
  await handler(fakeRequest("group.link.delete", { linkId: 0 }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_group_link_id" });
  assert.equal(vkCalls, 0);
});
