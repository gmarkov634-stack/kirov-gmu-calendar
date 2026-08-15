import assert from "node:assert/strict";
import test from "node:test";
import { createVkOauthStartHandler, VK_OAUTH_PROBE } from "../src/vk-oauth-start.js";

function fakeRequest(method = "GET", url = "/api/v1/vk/oauth/start") {
  return { method, url };
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

const handler = createVkOauthStartHandler();

test("VK OAuth start page is no-store and works without client-side JavaScript", async () => {
  const response = fakeResponse();
  await handler(fakeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
  assert.match(response.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(response.body.includes("<script"), false);
  assert.equal(response.body.includes("unpkg.com"), false);
  assert.match(response.body, /Проверить доступ VK/);
  assert.match(response.body, /wall/);
  assert.match(response.body, /groups/);
  assert.ok(response.body.includes(VK_OAUTH_PROBE.beginPath));
  assert.equal(response.body.includes("VK_ACCESS_TOKEN"), false);
  assert.equal(response.body.includes("VK_USER_ACCESS_TOKEN"), false);
  assert.equal(response.body.includes("refresh_token"), false);
});

test("VK OAuth begin endpoint redirects to VK ID with PKCE and exact registered boundary", async () => {
  const response = fakeResponse();
  await handler(fakeRequest("GET", VK_OAUTH_PROBE.beginPath), response);

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.ok(Array.isArray(response.headers["Set-Cookie"]));
  assert.equal(response.headers["Set-Cookie"].length, 2);
  for (const cookie of response.headers["Set-Cookie"]) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=900/);
  }

  const target = new URL(response.headers.Location);
  assert.equal(target.origin + target.pathname, VK_OAUTH_PROBE.authorizeUrl);
  assert.equal(target.searchParams.get("client_id"), String(VK_OAUTH_PROBE.appId));
  assert.equal(target.searchParams.get("app_id"), String(VK_OAUTH_PROBE.appId));
  assert.equal(target.searchParams.get("redirect_uri"), VK_OAUTH_PROBE.redirectUrl);
  assert.equal(target.searchParams.get("response_type"), "code");
  assert.equal(target.searchParams.get("scope"), VK_OAUTH_PROBE.scope);
  assert.equal(target.searchParams.get("code_challenge_method"), "s256");
  assert.match(target.searchParams.get("state") || "", /^[A-Za-z0-9_-]{20,}$/);
  assert.match(target.searchParams.get("code_challenge") || "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(target.searchParams.get("sdk_type"), "vkid");
});

test("VK OAuth begin endpoint generates fresh state and PKCE challenge", async () => {
  const first = fakeResponse();
  const second = fakeResponse();
  await handler(fakeRequest("GET", VK_OAUTH_PROBE.beginPath), first);
  await handler(fakeRequest("GET", VK_OAUTH_PROBE.beginPath), second);

  const firstUrl = new URL(first.headers.Location);
  const secondUrl = new URL(second.headers.Location);
  assert.notEqual(firstUrl.searchParams.get("state"), secondUrl.searchParams.get("state"));
  assert.notEqual(firstUrl.searchParams.get("code_challenge"), secondUrl.searchParams.get("code_challenge"));
});

test("VK OAuth probe rejects non-GET methods", async () => {
  const response = fakeResponse();
  await handler(fakeRequest("POST"), response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "method_not_allowed" });
  assert.equal(response.headers.Allow, "GET");
});
