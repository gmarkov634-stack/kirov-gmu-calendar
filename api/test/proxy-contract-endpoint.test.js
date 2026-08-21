import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

const adminToken = "a".repeat(32);

async function withServer(callback) {
  const server = http.createServer(createHandler({ store: {}, config: { adminToken } }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("proxy contract endpoint requires admin authentication", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/admin/proxy-contract`);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "admin_forbidden" });
}));

test("proxy contract endpoint returns structure without raw IP values", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/admin/proxy-contract`, {
    headers: {
      "X-Admin-Token": adminToken,
      "X-Real-IP": "203.0.113.10",
      "X-Forwarded-For": "203.0.113.10, 198.51.100.7",
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, 1);
  assert.equal(body.xRealIpPresent, true);
  assert.equal(body.xForwardedForHopCount, 2);
  assert.equal(body.xRealIpEqualsFirstXff, true);
  assert.equal(body.policyResolution, "x-real-ip");
  assert.doesNotMatch(JSON.stringify(body), /203\.0\.113\.10|198\.51\.100\.7/);
  assert.equal(response.headers.get("cache-control"), "no-store");
}));
