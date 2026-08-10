import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createVkControlHandler, verifyGitHubOidcToken } from "../src/vk-control.js";

function fakeRequest(body, authorization = "Bearer test-oidc") {
  return {
    method: "POST",
    headers: authorization ? { authorization } : {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
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

function parseResponse(response) {
  return JSON.parse(response.body || "{}");
}

const now = Date.parse("2026-08-10T18:40:00.000Z");
const createdAt = "2026-08-10T18:39:00.000Z";
const env = {
  VK_CALLBACK_GROUP_ID: "191574528",
  VK_ACCESS_TOKEN: "vk1-test-token",
  VK_API_VERSION: "5.199",
};

function command(action, payload = {}) {
  return {
    id: `cmd-${action.replaceAll(".", "-")}-0001`,
    action,
    createdAt,
    payload,
  };
}

function handler(fetchImpl, extra = {}) {
  return createVkControlHandler(env, {
    fetchImpl,
    nowFactory: () => now,
    verifyOidcToken: async (token) => {
      assert.equal(token, "test-oidc");
      return { repository: "gmarkov634-stack/kirov-gmu-calendar" };
    },
    ...extra,
  });
}

function vkSuccess(responseValue, requests) {
  return async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { response: responseValue };
      },
    };
  };
}

function jwt(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

test("GitHub OIDC verifier accepts only the expected repository pull-request identity", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-kid-control-plane";
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.use = "sig";
  jwk.alg = "RS256";

  const nowSeconds = Math.floor(now / 1000);
  const token = jwt(privateKey, kid, {
    iss: "https://token.actions.githubusercontent.com",
    aud: "kgmu-vk-control",
    exp: nowSeconds + 300,
    nbf: nowSeconds - 10,
    repository: "gmarkov634-stack/kirov-gmu-calendar",
    actor: "gmarkov634-stack",
    event_name: "pull_request",
    ref: "refs/pull/77/merge",
  });

  const claims = await verifyGitHubOidcToken(token, {
    now,
    fetchImpl: async (url) => {
      assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
      return {
        ok: true,
        async json() {
          return { keys: [jwk] };
        },
      };
    },
  });
  assert.equal(claims.repository, "gmarkov634-stack/kirov-gmu-calendar");
});

test("control endpoint requires GitHub OIDC authorization", async () => {
  const response = fakeResponse();
  await handler(async () => { throw new Error("must not fetch"); })(
    fakeRequest(command("wall.list"), ""),
    response,
  );
  assert.equal(response.statusCode, 401);
  assert.deepEqual(parseResponse(response), { error: "unauthorized" });
});

test("control endpoint rejects an OIDC token that fails verification", async () => {
  const response = fakeResponse();
  const control = createVkControlHandler(env, {
    nowFactory: () => now,
    verifyOidcToken: async () => { throw new Error("bad identity"); },
    fetchImpl: async () => { throw new Error("must not fetch VK"); },
  });
  await control(fakeRequest(command("wall.list")), response);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(parseResponse(response), { error: "forbidden" });
});

test("wall.list reads the fixed community and returns sanitized posts", async () => {
  const requests = [];
  const response = fakeResponse();
  const fetchImpl = vkSuccess({
    count: 1,
    items: [{
      id: 321,
      date: 1786380000,
      text: "Тестовый пост",
      is_pinned: 1,
      comments: { count: 2 },
      likes: { count: 3 },
      reposts: { count: 4 },
      views: { count: 50 },
      attachments: [{
        type: "photo",
        photo: {
          id: 9,
          owner_id: -191574528,
          text: "Фото",
          sizes: [
            { width: 100, height: 100, url: "https://example.test/small.jpg" },
            { width: 1200, height: 800, url: "https://example.test/large.jpg" },
          ],
        },
      }],
    }],
  }, requests);

  await handler(fetchImpl)(fakeRequest(command("wall.list")), response);
  assert.equal(response.statusCode, 200);
  const result = parseResponse(response);
  assert.equal(result.ok, true);
  assert.equal(result.result.total, 1);
  assert.equal(result.result.posts[0].id, 321);
  assert.equal(result.result.posts[0].text, "Тестовый пост");
  assert.equal(result.result.posts[0].attachments[0].imageUrl, "https://example.test/large.jpg");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/wall.get");
  assert.equal(requests[0].options.body.get("owner_id"), "-191574528");
  assert.equal(requests[0].options.body.get("access_token"), "vk1-test-token");
});

test("wall.post publishes as the community and uses the command id as VK guid", async () => {
  const requests = [];
  const response = fakeResponse();
  const input = command("wall.post", { message: "Новый пост" });

  await handler(vkSuccess({ post_id: 444 }, requests))(fakeRequest(input), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parseResponse(response).result, { postId: 444 });
  assert.equal(requests[0].url, "https://api.vk.com/method/wall.post");
  assert.equal(requests[0].options.body.get("owner_id"), "-191574528");
  assert.equal(requests[0].options.body.get("from_group"), "1");
  assert.equal(requests[0].options.body.get("message"), "Новый пост");
  assert.equal(requests[0].options.body.get("guid"), input.id);
});

test("wall.edit changes only a concrete post on the fixed community wall", async () => {
  const requests = [];
  const response = fakeResponse();
  await handler(vkSuccess(1, requests))(
    fakeRequest(command("wall.edit", { postId: 444, message: "Исправленный пост" })),
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parseResponse(response).result, { postId: 444, edited: true });
  assert.equal(requests[0].url, "https://api.vk.com/method/wall.edit");
  assert.equal(requests[0].options.body.get("post_id"), "444");
});

test("wall.delete, wall.pin and wall.unpin are restricted to a positive post id", async () => {
  for (const action of ["wall.delete", "wall.pin", "wall.unpin"]) {
    const requests = [];
    const response = fakeResponse();
    await handler(vkSuccess(1, requests))(
      fakeRequest(command(action, { postId: 500 })),
      response,
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(parseResponse(response).result, { postId: 500, success: true });
    assert.equal(requests[0].url, `https://api.vk.com/method/${action}`);
    assert.equal(requests[0].options.body.get("owner_id"), "-191574528");
  }
});

test("stale commands are rejected before VK is called", async () => {
  let calls = 0;
  const response = fakeResponse();
  const stale = { ...command("wall.list"), createdAt: "2026-08-10T17:00:00.000Z" };
  await handler(async () => { calls += 1; })(fakeRequest(stale), response);
  assert.equal(response.statusCode, 400);
  assert.equal(parseResponse(response).error, "invalid_command");
  assert.equal(calls, 0);
});
