import assert from "node:assert/strict";
import test from "node:test";
import { createVkOauthCallbackHandler } from "../src/vk-oauth-callback.js";

function fakeRequest(url, method = "GET") {
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

const handler = createVkOauthCallbackHandler();

test("VK OAuth callback accepts the expected response shape without echoing secrets", async () => {
  const response = fakeResponse();
  const code = "sensitive-authorization-code";
  const state = "sensitive-state";
  const deviceId = "sensitive-device-id";

  await handler(fakeRequest(`/api/v1/vk/oauth/callback?code=${code}&state=${state}&device_id=${deviceId}`), response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Ответ VK ID получен/);
  assert.equal(response.body.includes(code), false);
  assert.equal(response.body.includes(state), false);
  assert.equal(response.body.includes(deviceId), false);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
  assert.match(response.headers["Content-Security-Policy"], /default-src 'none'/);
});

test("VK OAuth callback fails closed when required response parameters are missing", async () => {
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
  const response = fakeResponse();
  const sensitiveDescription = "very-sensitive-provider-description";

  await handler(fakeRequest(`/api/v1/vk/oauth/callback?error=access_denied&error_description=${sensitiveDescription}`), response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Авторизация VK ID не завершена/);
  assert.equal(response.body.includes("access_denied"), false);
  assert.equal(response.body.includes(sensitiveDescription), false);
});

test("VK OAuth callback rejects non-GET methods", async () => {
  const response = fakeResponse();
  await handler(fakeRequest("/api/v1/vk/oauth/callback", "POST"), response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "method_not_allowed" });
  assert.equal(response.headers.Allow, "GET");
});
