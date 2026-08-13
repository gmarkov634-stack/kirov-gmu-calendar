import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createKgmuParserHandler } from "../src/adapters/kgmu/http-handler.mjs";

const adminToken = "z".repeat(40);

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function handler({ service = {}, reviewedService = {}, config = {}, queue = {} } = {}) {
  return createKgmuParserHandler({
    service,
    reviewedService,
    queue: {
      listReviews: async () => [],
      getReview: async () => null,
      getSource: async () => null,
      ...queue,
    },
    notifier: null,
    watcher: null,
    config: {
      adminToken,
      kgmuXlsxMaxBytes: 1024,
      allowedOrigins: ["https://gmarkov634-stack.github.io"],
      ...config,
    },
  });
}

test("reviewed bundle endpoint forwards JSON to reviewed service and can publish atomically", () => {
  let submitted = null;
  return withServer(handler({
    reviewedService: {
      submit: async (bundle, options) => {
        submitted = { bundle, options };
        return { status: "PUBLISHED", publicationBlocked: false };
      },
    },
  }), async (base) => {
    const body = { version: 1, university: "kgmu", groups: {} };
    const response = await fetch(`${base}/api/v1/admin/kgmu/reviewed-bundle?publish=true`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "PUBLISHED", publicationBlocked: false });
    assert.deepEqual(submitted, { bundle: body, options: { publish: true } });
  });
});

test("manual-normalization ingest stores the exact uploaded XLSX through reviewed source observation", () => {
  let observed = null;
  return withServer(handler({
    config: { kgmuXlsxParserEnabled: false },
    service: { ingest: async () => { throw new Error("legacy parser must not run"); } },
    reviewedService: {
      observeSource: async (buffer, metadata) => {
        observed = { bytes: Buffer.from(buffer), metadata };
        return {
          reviewId: "123e4567-e89b-12d3-a456-426614174000",
          status: "REVIEW_REQUIRED",
          reason: "MANUAL_NORMALIZATION_REQUIRED",
          sourceSha256: "a".repeat(64),
          publicationBlocked: true,
        };
      },
    },
  }), async (base) => {
    const sourceUrl = "https://kirovgma.ru/sites/default/files/files/2026/02/02/1078/4_kurs.xlsx";
    const url = new URL(`${base}/api/v1/admin/kgmu/ingest`);
    url.searchParams.set("filename", "4_kurs.xlsx");
    url.searchParams.set("program", "medicine");
    url.searchParams.set("course", "4");
    url.searchParams.set("academicYear", "2025/26");
    url.searchParams.set("semester", "2");
    url.searchParams.set("groupRange", "401-420");
    url.searchParams.set("sourceUrl", sourceUrl);
    const body = Buffer.from("PK-reviewed-xlsx");
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-admin-token": adminToken, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body,
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      reviewId: "123e4567-e89b-12d3-a456-426614174000",
      status: "REVIEW_REQUIRED",
      reason: "MANUAL_NORMALIZATION_REQUIRED",
      sourceSha256: "a".repeat(64),
      publicationBlocked: true,
    });
    assert.deepEqual(observed, {
      bytes: body,
      metadata: {
        filename: "4_kurs.xlsx",
        program: "medicine",
        course: "4",
        academicYear: "2025/26",
        semester: "2",
        groupRange: "401-420",
        sourceUrl,
      },
    });
  });
});

test("canonical parser-review endpoint submits schedule-batch package against the existing review id", () => {
  let submitted = null;
  return withServer(handler({
    reviewedService: {
      submitCanonical: async (reviewId, input, options) => {
        submitted = { reviewId, input, options };
        return { reviewId, status: "READY_TO_PUBLISH", parserType: "REVIEWED_JSON", publicationBlocked: true };
      },
    },
  }), async (base) => {
    const reviewId = "123e4567-e89b-12d3-a456-426614174000";
    const body = { format: "canonical-reviewed/v1", rules_revision: "R69", batches: [{ schema_version: "1.0" }] };
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/canonical`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      reviewId,
      status: "READY_TO_PUBLISH",
      parserType: "REVIEWED_JSON",
      publicationBlocked: true,
    });
    assert.deepEqual(submitted, { reviewId, input: body, options: { publish: false } });
  });
});

test("canonical parser-review endpoint can publish in the same request", () => {
  return withServer(handler({
    reviewedService: {
      submitCanonical: async (reviewId, input, options) => ({
        reviewId,
        format: input.format,
        publish: options.publish,
        status: "PUBLISHED",
        publicationBlocked: false,
      }),
    },
  }), async (base) => {
    const reviewId = "123e4567-e89b-12d3-a456-426614174000";
    const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/canonical?publish=true`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ format: "canonical-reviewed/v1", rules_revision: "R69", batches: [] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      reviewId,
      format: "canonical-reviewed/v1",
      publish: true,
      status: "PUBLISHED",
      publicationBlocked: false,
    });
  });
});

test("retired XLSX dry-run returns 410 without invoking legacy parser", () => {
  let called = false;
  return withServer(handler({
    service: { dryRun: async () => { called = true; return {}; } },
    config: { kgmuXlsxParserEnabled: false },
  }), async (base) => {
    const response = await fetch(`${base}/api/v1/admin/kgmu/dry-run`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
      body: Buffer.from("PK-old-parser"),
    });
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: "xlsx_parser_retired", normalization: "reviewed_json" });
    assert.equal(called, false);
  });
});

test("reviewed JSON review publish is dispatched to reviewed service", () => withServer(handler({
  service: { publishReview: async () => { throw new Error("legacy publisher must not be called"); } },
  reviewedService: { publishReview: async (id) => ({ reviewId: id, status: "PUBLISHED", parserType: "REVIEWED_JSON" }) },
  queue: { getReview: async (id) => ({ reviewId: id, parserType: "REVIEWED_JSON" }) },
}), async (base) => {
  const reviewId = "123e4567-e89b-12d3-a456-426614174000";
  const response = await fetch(`${base}/api/v1/admin/parser-reviews/${reviewId}/publish`, {
    method: "POST",
    headers: { "x-admin-token": adminToken },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reviewId, status: "PUBLISHED", parserType: "REVIEWED_JSON" });
}));