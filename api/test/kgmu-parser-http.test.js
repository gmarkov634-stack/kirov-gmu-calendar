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

function handler(service) {
  return createKgmuParserHandler({
    service,
    queue: { listReviews: async () => [], getReview: async () => null },
    config: { adminToken, kgmuXlsxMaxBytes: 1024 },
  });
}

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
