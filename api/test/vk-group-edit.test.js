import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-15T22:15:00.000Z");

function fakeRequest(payload, action = "group.edit") {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: "cmd-group-edit-0001",
        action,
        createdAt: "2026-08-15T22:14:00.000Z",
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

function makeHandler({ communityToken = "community-token", fetchImpl, tokenManager } = {}) {
  return createVkControlHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    ...(communityToken ? { VK_ACCESS_TOKEN: communityToken } : {}),
    VK_USER_ACCESS_TOKEN: "legacy-user-token-must-not-be-used",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: tokenManager || {
      configured: true,
      async getAccessToken() {
        throw new Error("managed token must not be used for group.edit");
      },
    },
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: fetchImpl || (async () => { throw new Error("unexpected VK call"); }),
  });
}

test("group.edit updates name, description and website through the community token", async () => {
  const requests = [];
  let managedTokenCalls = 0;
  const response = fakeResponse();
  const handler = makeHandler({
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token-must-not-be-used";
      },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() { return { response: 1 }; },
      };
    },
  });

  const name = "Расписание в телефоне | ОмГМУ";
  const description = "Новое описание сообщества";
  const website = "https://gmarkov634-stack.github.io/kirov-gmu-calendar";
  await handler(fakeRequest({ name, description, website }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/groups.edit");
  const body = requests[0].options.body;
  assert.equal(body.get("access_token"), "community-token");
  assert.equal(body.get("v"), "5.199");
  assert.equal(body.get("group_id"), "191574528");
  assert.equal(body.get("title"), name);
  assert.equal(body.get("description"), description);
  assert.equal(body.get("website"), website);
  assert.equal(body.get("screen_name"), null);
  assert.equal(body.get("access"), null);
  assert.equal(body.get("subject"), null);
  assert.equal(body.get("status"), null);
  assert.deepEqual(JSON.parse(response.body).result, {
    updated: true,
    fields: ["name", "description", "website"],
  });
});

test("group.edit maps a name-only mutation to VK title and does not broaden the request", async () => {
  const requests = [];
  const response = fakeResponse();
  const handler = makeHandler({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, async json() { return { response: 1 }; } };
    },
  });

  await handler(fakeRequest({ name: "  Расписание в телефоне | ОмГМУ  " }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 1);
  const body = requests[0].options.body;
  assert.equal(body.get("title"), "Расписание в телефоне | ОмГМУ");
  assert.equal(body.get("description"), null);
  assert.equal(body.get("website"), null);
  assert.equal(body.get("status"), null);
  assert.deepEqual(JSON.parse(response.body).result.fields, ["name"]);
});

test("group.edit rejects any field outside the strict allowlist", async () => {
  let vkCalls = 0;
  const handler = makeHandler({
    fetchImpl: async () => {
      vkCalls += 1;
      return { ok: true, async json() { return { response: 1 }; } };
    },
  });

  for (const payload of [
    { title: "Raw VK title is not a control field" },
    { status: "Нельзя менять статус через groups.edit" },
    { screen_name: "other" },
    { subject: "1" },
  ]) {
    const response = fakeResponse();
    await handler(fakeRequest(payload), response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "invalid_group_edit_payload" });
  }
  assert.equal(vkCalls, 0);
});

test("group.edit rejects invalid names, an empty payload and a non-HTTPS website", async () => {
  let vkCalls = 0;
  const handler = makeHandler({
    fetchImpl: async () => {
      vkCalls += 1;
      return { ok: true, async json() { return { response: 1 }; } };
    },
  });

  for (const name of ["", "   ", "x".repeat(101)]) {
    const response = fakeResponse();
    await handler(fakeRequest({ name }), response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "invalid_group_name" });
  }

  const emptyResponse = fakeResponse();
  await handler(fakeRequest({}), emptyResponse);
  assert.equal(emptyResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(emptyResponse.body), { error: "invalid_group_edit_payload" });

  const websiteResponse = fakeResponse();
  await handler(fakeRequest({ website: "http://example.test" }), websiteResponse);
  assert.equal(websiteResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(websiteResponse.body), { error: "invalid_group_website" });
  assert.equal(vkCalls, 0);
});

test("group.edit fails closed without a community token and never falls back to a user token", async () => {
  let managedTokenCalls = 0;
  let vkCalls = 0;
  const response = fakeResponse();
  const handler = makeHandler({
    communityToken: "",
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token";
      },
    },
    fetchImpl: async () => {
      vkCalls += 1;
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest({ name: "Расписание в телефоне | ОмГМУ" }), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
  assert.equal(managedTokenCalls, 0);
  assert.equal(vkCalls, 0);
});
