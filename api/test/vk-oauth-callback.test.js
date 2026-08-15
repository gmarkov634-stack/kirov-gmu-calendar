import assert from "node:assert/strict";
import test from "node:test";
import { createVkOauthCallbackHandler, VK_OAUTH_EXCHANGE } from "../src/vk-oauth-callback.js";

function fakeRequest(url, method = "GET", cookie = "") {
  return { method, url, headers: cookie ? { cookie } : {} };
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

function cookieHeader(state = "state-123", verifier = "verifier-456") {
  return `${VK_OAUTH_EXCHANGE.stateCookie}=${state}; ${VK_OAUTH_EXCHANGE.verifierCookie}=${verifier}`;
}

test("VK OAuth callback exchanges PKCE code and proves wall.get without echoing or persisting secrets", async () => {
  const calls = [];
  const accessToken = "sensitive-access-token";
  const refreshToken = "sensitive-refresh-token";
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith(VK_OAUTH_EXCHANGE.tokenUrl)) {
      return {
        ok: true,
        async json() {
          return { access_token: accessToken, refresh_token: refreshToken, state: "state-123" };
        },
      };
    }
    if (String(url) === VK_OAUTH_EXCHANGE.wallGetUrl) {
      return {
        ok: true,
        async json() {
          return { response: { count: 7, items: [] } };
        },
      };
    }
    throw new Error("unexpected_fetch");
  };
  const handler = createVkOauthCallbackHandler(
    { VK_CALLBACK_GROUP_ID: "12345", VK_API_VERSION: "5.199" },
    { fetchImpl },
  );
  const response = fakeResponse();
  const code = "authorization-code";
  const deviceId = "device-id";

  await handler(
    fakeRequest(
      `/api/v1/vk/oauth/callback?code=${code}&state=state-123&device_id=${deviceId}`,
      "GET",
      cookieHeader(),
    ),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Доступ к стене VK подтверждён/);
  assert.match(response.body, /7/);
  for (const secret of [code, deviceId, accessToken, refreshToken, "verifier-456"]) {
    assert.equal(response.body.includes(secret), false);
  }
  assert.equal(calls.length, 2);

  const tokenUrl = new URL(calls[0].url);
  assert.equal(tokenUrl.origin + tokenUrl.pathname, VK_OAUTH_EXCHANGE.tokenUrl);
  assert.equal(tokenUrl.searchParams.get("grant_type"), "authorization_code");
  assert.equal(tokenUrl.searchParams.get("client_id"), String(VK_OAUTH_EXCHANGE.appId));
  assert.equal(tokenUrl.searchParams.get("redirect_uri"), VK_OAUTH_EXCHANGE.redirectUrl);
  assert.equal(tokenUrl.searchParams.get("state"), "state-123");
  assert.equal(tokenUrl.searchParams.get("device_id"), deviceId);
  assert.equal(tokenUrl.searchParams.get("code_verifier"), "verifier-456");
  assert.equal(String(calls[0].options.body.get("code")), code);

  const wallBody = calls[1].options.body;
  assert.equal(wallBody.get("access_token"), accessToken);
  assert.equal(wallBody.get("owner_id"), "-12345");
  assert.equal(wallBody.get("count"), "1");
  assert.equal(wallBody.get("filter"), "owner");

  const cleared = response.headers["Set-Cookie"];
  assert.equal(Array.isArray(cleared), true);
  assert.equal(cleared.length, 2);
  assert.ok(cleared.every((value) => value.includes("Max-Age=0")));
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
});

test("VK OAuth callback fails closed on missing or mismatched PKCE cookies before network calls", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("should_not_fetch");
  };
  const handler = createVkOauthCallbackHandler({ VK_CALLBACK_GROUP_ID: "12345" }, { fetchImpl });

  for (const cookie of ["", cookieHeader("wrong-state", "verifier-456")]) {
    const response = fakeResponse();
    await handler(
      fakeRequest(
        "/api/v1/vk/oauth/callback?code=x&state=state-123&device_id=z",
        "GET",
        cookie,
      ),
      response,
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Проверка OAuth не пройдена/);
  }
  assert.equal(calls, 0);
});

test("VK OAuth callback fails closed when required response parameters are missing", async () => {
  const handler = createVkOauthCallbackHandler({ VK_CALLBACK_GROUP_ID: "12345" }, { fetchImpl: async () => { throw new Error("should_not_fetch"); } });
  for (const url of [
    "/api/v1/vk/oauth/callback",
    "/api/v1/vk/oauth/callback?code=x&state=y",
    "/api/v1/vk/oauth/callback?code=x&device_id=z",
    "/api/v1/vk/oauth/callback?state=y&device_id=z",
  ]) {
    const response = fakeResponse();
    await handler(fakeRequest(url), response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Некорректный ответ VK ID/);
  }
});

test("VK OAuth callback sanitizes provider errors", async () => {
  const handler = createVkOauthCallbackHandler({ VK_CALLBACK_GROUP_ID: "12345" });
  const response = fakeResponse();
  const sensitiveDescription = "very-sensitive-provider-description";
  await handler(fakeRequest(`/api/v1/vk/oauth/callback?error=access_denied&error_description=${sensitiveDescription}`), response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Авторизация VK ID не завершена/);
  assert.equal(response.body.includes("access_denied"), false);
  assert.equal(response.body.includes(sensitiveDescription), false);
});

test("VK OAuth callback reports wall probe failure without leaking token material", async () => {
  const accessToken = "secret-token";
  let index = 0;
  const fetchImpl = async () => {
    index += 1;
    if (index === 1) {
      return { ok: true, async json() { return { access_token: accessToken, state: "state-123" }; } };
    }
    return { ok: true, async json() { return { error: { error_code: 27, error_msg: "failure" } }; } };
  };
  const handler = createVkOauthCallbackHandler({ VK_CALLBACK_GROUP_ID: "12345" }, { fetchImpl });
  const response = fakeResponse();
  await handler(
    fakeRequest(
      "/api/v1/vk/oauth/callback?code=x&state=state-123&device_id=z",
      "GET",
      cookieHeader(),
    ),
    response,
  );
  assert.equal(response.statusCode, 502);
  assert.match(response.body, /Проверка доступа к стене не пройдена/);
  assert.equal(response.body.includes(accessToken), false);
});

test("VK OAuth callback rejects non-GET methods", async () => {
  const handler = createVkOauthCallbackHandler();
  const response = fakeResponse();
  await handler(fakeRequest("/api/v1/vk/oauth/callback", "POST"), response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "method_not_allowed" });
  assert.equal(response.headers.Allow, "GET");
});
