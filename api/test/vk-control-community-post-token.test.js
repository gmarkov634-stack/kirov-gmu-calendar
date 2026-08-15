import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-15T21:00:00.000Z");

function fakeRequest(command) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(command));
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

function command(action, payload = {}) {
  return {
    id: `cmd-${action.replaceAll(".", "-")}-community-0001`,
    action,
    createdAt: "2026-08-15T20:59:00.000Z",
    payload,
  };
}

function makeHandler(env, { fetchImpl, tokenManager } = {}) {
  return createVkControlHandler(env, {
    tokenManager,
    nowFactory: () => now,
    verifyOidcToken: async () => ({}),
    fetchImpl: fetchImpl || (async () => { throw new Error("VK must not be called"); }),
  });
}

test("VK control routes wall.post through community token and does not request managed token", async () => {
  let managedTokenCalls = 0;
  let requestBody = null;
  const response = fakeResponse();
  const handler = makeHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token-must-not-be-used";
      },
    },
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return { ok: true, async json() { return { response: { post_id: 61 } }; } };
    },
  });

  await handler(fakeRequest(command("wall.post", { message: "Тест публикации" })), response);

  assert.equal(response.statusCode, 200);
  assert.equal(managedTokenCalls, 0);
  assert.equal(requestBody.get("access_token"), "community-token");
  assert.equal(requestBody.get("owner_id"), "-191574528");
  assert.equal(requestBody.get("from_group"), "1");
  assert.deepEqual(JSON.parse(response.body).result, { postId: 61 });
});

test("VK control fails closed for wall.post when community token is absent", async () => {
  let managedTokenCalls = 0;
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = makeHandler({
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
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest(command("wall.post", { message: "Тест" })), response);

  assert.equal(response.statusCode, 503);
  assert.equal(managedTokenCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_control_not_configured" });
});

test("VK control fails closed for wall.delete before selecting any token", async () => {
  let managedTokenCalls = 0;
  let fetchCalls = 0;
  const response = fakeResponse();
  const handler = makeHandler({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "community-token",
    VK_API_VERSION: "5.199",
  }, {
    tokenManager: {
      configured: true,
      async getAccessToken() {
        managedTokenCalls += 1;
        return "managed-user-token";
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("VK must not be called");
    },
  });

  await handler(fakeRequest(command("wall.delete", { postId: 60 })), response);

  assert.equal(response.statusCode, 501);
  assert.equal(managedTokenCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(response.body), { error: "vk_wall_delete_not_supported" });
});

test("VK control fails closed for wall.pin and wall.unpin before selecting any token", async () => {
  for (const action of ["wall.pin", "wall.unpin"]) {
    let managedTokenCalls = 0;
    let fetchCalls = 0;
    const response = fakeResponse();
    const handler = makeHandler({
      VK_CALLBACK_GROUP_ID: "191574528",
      VK_ACCESS_TOKEN: "community-token",
      VK_API_VERSION: "5.199",
    }, {
      tokenManager: {
        configured: true,
        async getAccessToken() {
          managedTokenCalls += 1;
          return "managed-user-token";
        },
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("VK must not be called");
      },
    });

    await handler(fakeRequest(command(action, { postId: 64 })), response);

    assert.equal(response.statusCode, 501);
    assert.equal(managedTokenCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(JSON.parse(response.body), { error: "vk_wall_pin_not_supported" });
  }
});
