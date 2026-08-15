import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createOmgmuReviewHandler } from "../src/adapters/omgmu/http-handler.mjs";

function request(url, { method = "GET", token } = {}) {
  const value = new EventEmitter();
  value.url = url;
  value.method = method;
  value.headers = token ? { "x-admin-token": token } : {};
  return value;
}

function response() {
  return {
    status: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body ?? null; },
  };
}

const token = "t".repeat(40);
const reviewId = "00000000-0000-0000-0000-000000000008";

function fixture() {
  const pdf = Buffer.from("%PDF-1.7\nreview");
  const queue = {
    async listReviews() { return [{ reviewId, university: "omgmu", status: "REVIEW_REQUIRED" }]; },
    async getReview(id) { return id === reviewId ? { reviewId, university: "omgmu", status: "REVIEW_REQUIRED", sourceKey: "source-key", metadata: { filename: "source.pdf" } } : null; },
    async getSource(key) { return key === "source-key" ? pdf : null; },
  };
  const watcher = { async run() { return { status: "OK", newReviewCount: 1, publicationAction: "review-required" }; } };
  const config = { adminToken: token, allowedOrigins: ["https://example.test"] };
  return { handler: createOmgmuReviewHandler({ queue, watcher, config }), pdf };
}

test("ОмГМУ review endpoints require the existing admin token", async () => {
  const { handler } = fixture();
  const res = response();
  await handler(request("/api/v1/admin/omgmu/parser-reviews"), res);
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error, "admin_forbidden");
});

test("admin can list and read ОмГМУ review candidates without a publication action", async () => {
  const { handler } = fixture();
  const list = response();
  await handler(request("/api/v1/admin/omgmu/parser-reviews", { token }), list);
  assert.equal(list.status, 200);
  assert.equal(JSON.parse(list.body).reviews[0].status, "REVIEW_REQUIRED");

  const item = response();
  await handler(request(`/api/v1/admin/omgmu/parser-reviews/${reviewId}`, { token }), item);
  assert.equal(item.status, 200);
  assert.equal(JSON.parse(item.body).reviewId, reviewId);
});

test("admin downloads the exact staged ОмГМУ PDF attached to the review", async () => {
  const { handler, pdf } = fixture();
  const res = response();
  await handler(request(`/api/v1/admin/omgmu/parser-reviews/${reviewId}/source`, { token }), res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.deepEqual(res.body, pdf);
});

test("manual ОмГМУ watch endpoint can create review candidates but exposes no publish route", async () => {
  const { handler } = fixture();
  const watch = response();
  await handler(request("/api/v1/admin/omgmu/watch", { method: "POST", token }), watch);
  assert.equal(watch.status, 200);
  assert.equal(JSON.parse(watch.body).publicationAction, "review-required");

  const publish = response();
  await handler(request(`/api/v1/admin/omgmu/parser-reviews/${reviewId}/publish`, { method: "POST", token }), publish);
  assert.equal(publish.status, 404);
});
