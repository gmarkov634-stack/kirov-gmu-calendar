import assert from "node:assert/strict";
import test from "node:test";
import { createVkOauthStartHandler, VK_OAUTH_PROBE } from "../src/vk-oauth-start.js";

function fakeRequest(method = "GET") {
  return { method, url: "/api/v1/vk/oauth/start" };
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

test("VK OAuth start page is a no-store wall/groups probe using the registered app boundary", async () => {
  const response = fakeResponse();
  await handler(fakeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
  assert.match(response.headers["Content-Security-Policy"], /https:\/\/unpkg\.com/);
  assert.match(response.headers["Content-Security-Policy"], /nonce-/);
  assert.match(response.body, /Проверить доступ VK/);
  assert.match(response.body, /wall/);
  assert.match(response.body, /groups/);
  assert.match(response.body, new RegExp(String(VK_OAUTH_PROBE.appId)));
  assert.ok(response.body.includes(VK_OAUTH_PROBE.redirectUrl));
  assert.ok(response.body.includes(VK_OAUTH_PROBE.sdkUrl));
  assert.ok(response.body.includes(`scope: ${JSON.stringify(VK_OAUTH_PROBE.scope)}`));
  assert.equal(response.body.includes("VK_ACCESS_TOKEN"), false);
  assert.equal(response.body.includes("VK_USER_ACCESS_TOKEN"), false);
  assert.equal(response.body.includes("refresh_token"), false);
});

test("VK OAuth start page uses a fresh CSP nonce for each response", async () => {
  const first = fakeResponse();
  const second = fakeResponse();
  await handler(fakeRequest(), first);
  await handler(fakeRequest(), second);

  const firstNonce = first.headers["Content-Security-Policy"].match(/nonce-([^' ]+)/)?.[1];
  const secondNonce = second.headers["Content-Security-Policy"].match(/nonce-([^' ]+)/)?.[1];
  assert.ok(firstNonce);
  assert.ok(secondNonce);
  assert.notEqual(firstNonce, secondNonce);
  assert.ok(first.body.includes(`nonce="${firstNonce}"`));
  assert.ok(second.body.includes(`nonce="${secondNonce}"`));
});

test("VK OAuth start page rejects non-GET methods", async () => {
  const response = fakeResponse();
  await handler(fakeRequest("POST"), response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "method_not_allowed" });
  assert.equal(response.headers.Allow, "GET");
});
