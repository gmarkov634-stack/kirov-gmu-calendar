import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createKgmuParserHandler } from "../src/adapters/kgmu/http-handler.mjs";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const adminToken = "x".repeat(40);
const reviewId = "123e4567-e89b-12d3-a456-426614174000";
const allowedOrigin = "https://gmarkov634-stack.github.io";

function handler(service, queue = {}, notifier = null) {
  return createKgmuParserHandler({
    service,
    queue: {
      listReviews: async () => [],
      getReview: async () => null,
      getSource: async () => null,
      ...queue,
    },
    notifier,
    config: {
      adminToken,
      kgmuXlsxMaxBytes: 1024,
      allowedOrigins: [allowedOrigin],
    },
  });
}

test("parser admin CORS preflight is allowed before admin authentication", () => withServer(
  handler({ publishReview: async () => ({}) }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/parser-reviews`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-admin-token",
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.match(response.headers.get("access-control-allow-headers"), /X-Admin-Token/i);
  },
));

test("Telegram admin test endpoint uses the configured review notifier", () => withServer(
  handler(
    { publishReview: async () => ({}) },
    {},
    { notifySystemTest: async () => ({ sent: true }) },
  ),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/kgmu/telegram-test`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sent: true });
  },
));

test("manual publish endpoint requires admin token", () => withServer(
  handler({ publishReview: async () => ({}) }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/publish`, { method: "POST" });
    assert.equal(response.status, 403);
  },
));

test("manual publish endpoint publishes READY_TO_PUBLISH review", () => withServer(
  handler({ publishReview: async (id) => ({ reviewId: id, status: "PUBLISHED" }) }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/publish`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reviewId, status: "PUBLISHED" });
  },
));

test("manual publish endpoint returns conflict for blocked review", () => withServer(
  handler({
    publishReview: async () => {
      const error = new Error("not ready");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    },
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/publish`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "review_not_publishable" });
  },
));

test("admin can download only the staged source attached to a parser review", () => withServer(
  handler(
    { publishReview: async () => ({}) },
    {
      getReview: async (id) => ({
        reviewId: id,
        sourceKey: `parser-staging/kgmu/sources/${"a".repeat(64)}/schedule.xlsx`,
        metadata: { filename: "расписание-101.xlsx" },
      }),
      getSource: async (key) => {
        assert.match(key, /^parser-staging\/kgmu\/sources\//);
        return Buffer.from("PK-test-xlsx");
      },
    },
  ),
  async (base) => {
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/source`, {
      headers: {
        "x-admin-token": adminToken,
        Origin: allowedOrigin,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "PK-test-xlsx");
  },
));
