import assert from "node:assert/strict";
import test from "node:test";

import { checkUgmuPostLaunchReadbackBoundary } from "../tools/ugmu-production-storage-verify.mjs";

function response(status, body = null) {
  return {
    status,
    async json() { return body; },
  };
}

test("post-launch production storage read-back uses GET-only checks and accepts launched UGMU meta", async () => {
  const requests = [];
  const fetchFn = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    const value = String(url);
    if (value.endsWith("/health")) return response(200, { status: "ok", service: "medical-calendar-api" });
    if (value.endsWith("/api/v2/meta")) return response(200, { sales: "open", trials: "closed", paymentMode: "live" });
    if (value.includes("/schedule?")) return response(404, { error: "schedule_not_published" });
    if (value.includes("/calendar.ics?")) return response(404, "not found");
    throw new Error(`Unexpected URL ${value}`);
  };

  const result = await checkUgmuPostLaunchReadbackBoundary("https://production.example/", fetchFn);

  assert.equal(result.passed, true);
  assert.equal(result.mode, "post-launch-production-read-only");
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.paymentCreated, false);
  assert.deepEqual(result.checks, {
    health: true,
    meta: true,
    salesOpen: true,
    trialsClosed: true,
    paymentModeLive: true,
    publicScheduleClosed: true,
    publicIcsClosed: true,
    getOnly: true,
  });
  assert.equal(requests.length, 4);
  assert.equal(requests.every((request) => request.method === "GET"), true);
  assert.equal(requests.some((request) => request.url.endsWith("/api/v2/payments")), false);
});

test("post-launch production storage read-back fails closed on meta or public visibility drift", async () => {
  const fetchFn = async (url) => {
    const value = String(url);
    if (value.endsWith("/health")) return response(200);
    if (value.endsWith("/api/v2/meta")) return response(200, { sales: "closed", trials: "open", paymentMode: "test" });
    if (value.includes("/schedule?")) return response(200, {});
    if (value.includes("/calendar.ics?")) return response(200, "");
    throw new Error(`Unexpected URL ${value}`);
  };

  const result = await checkUgmuPostLaunchReadbackBoundary("https://production.example", fetchFn);
  assert.equal(result.passed, false);
  assert.equal(result.checks.salesOpen, false);
  assert.equal(result.checks.trialsClosed, false);
  assert.equal(result.checks.paymentModeLive, false);
  assert.equal(result.checks.publicScheduleClosed, false);
  assert.equal(result.checks.publicIcsClosed, false);
});
