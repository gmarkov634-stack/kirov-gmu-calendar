import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createFunnelEventHandler } from "../src/funnel-events.js";

function request(body, { origin = "https://gmarkov634-stack.github.io", method = "POST" } = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  stream.url = "/api/v2/analytics";
  stream.headers = origin ? { origin } : {};
  return stream;
}

function response() {
  return {
    status: null,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = "") { this.body = body; },
  };
}

function config(enabled = true) {
  return {
    funnelAnalyticsEnabled: enabled,
    allowedOrigins: ["https://gmarkov634-stack.github.io"],
    offerAcademicYear: "2026/27",
    offerSemester: 1,
  };
}

const payload = {
  journeyId: "a".repeat(32),
  event: "landing_view",
  university: "kgmu",
  academicYear: "2026/27",
  semester: 1,
};

test("analytics endpoint is fail-closed when feature gate is off", async () => {
  const handler = createFunnelEventHandler({ store: {}, config: config(false) });
  const res = response();
  await handler(request(payload), res);
  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.body), { error: "analytics_not_open" });
});

test("analytics endpoint rejects non-allowlisted browser origin", async () => {
  const handler = createFunnelEventHandler({ store: {}, config: config(true) });
  const res = response();
  await handler(request(payload, { origin: "https://evil.example" }), res);
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.body), { error: "origin_forbidden" });
});

test("analytics endpoint accepts allowlisted event without returning identifiers", async () => {
  const records = new Map();
  const store = {
    async putFunnelRecord(key, value) { records.set(key, value); },
  };
  const handler = createFunnelEventHandler({
    store,
    config: config(true),
    now: () => new Date("2026-08-15T12:00:00.000Z"),
  });
  const res = response();
  await handler(request(payload), res);
  assert.equal(res.status, 202);
  assert.deepEqual(JSON.parse(res.body), { status: "accepted" });
  assert.equal(records.size, 1);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://gmarkov634-stack.github.io");
  assert.equal(res.body.includes(payload.journeyId), false);
});
