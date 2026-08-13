import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createKgmuParserHandler } from "../src/adapters/kgmu/http-handler.mjs";

function request(body, url, token) {
  const stream = Readable.from([body]);
  stream.method = "POST";
  stream.url = url;
  stream.headers = { "x-admin-token": token };
  return stream;
}

function response() {
  return {
    headers: {},
    statusCode: null,
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(value = "") { this.body += value; },
  };
}

test("manual-normalization ingest stores exact XLSX source instead of returning xlsx_parser_retired", async () => {
  const adminToken = "a".repeat(40);
  const bytes = Buffer.from("xlsx-source-bytes");
  let observed = null;
  let legacyIngestCalled = false;
  const handler = createKgmuParserHandler({
    service: {
      ingest: async () => {
        legacyIngestCalled = true;
        throw new Error("legacy parser must not run");
      },
    },
    reviewedService: {
      observeSource: async (buffer, metadata) => {
        observed = { buffer: Buffer.from(buffer), metadata };
        return {
          reviewId: "11111111-1111-4111-8111-111111111111",
          status: "REVIEW_REQUIRED",
          reason: "MANUAL_NORMALIZATION_REQUIRED",
          publicationBlocked: true,
        };
      },
    },
    queue: {},
    watcher: null,
    notifier: null,
    config: {
      adminToken,
      kgmuXlsxParserEnabled: false,
      kgmuXlsxMaxBytes: 1024,
    },
  });

  const params = new URLSearchParams({
    filename: "4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx",
    program: "medicine",
    course: "4",
    academicYear: "2025/26",
    semester: "2",
    groupRange: "401-420",
    sourceUrl: "https://kirovgma.ru/example.xlsx",
  });
  const req = request(bytes, `/api/v1/admin/kgmu/ingest?${params}`, adminToken);
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(legacyIngestCalled, false);
  assert.deepEqual(observed.buffer, bytes);
  assert.deepEqual(observed.metadata, {
    filename: "4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx",
    program: "medicine",
    course: "4",
    academicYear: "2025/26",
    semester: "2",
    groupRange: "401-420",
    sourceUrl: "https://kirovgma.ru/example.xlsx",
  });
  const body = JSON.parse(res.body);
  assert.equal(body.status, "REVIEW_REQUIRED");
  assert.equal(body.reason, "MANUAL_NORMALIZATION_REQUIRED");
});

test("enabled legacy parser keeps using service.ingest", async () => {
  const adminToken = "b".repeat(40);
  let reviewedCalled = false;
  let received = null;
  const handler = createKgmuParserHandler({
    service: {
      ingest: async (buffer, metadata) => {
        received = { buffer: Buffer.from(buffer), metadata };
        return { status: "READY_TO_PUBLISH" };
      },
    },
    reviewedService: {
      observeSource: async () => {
        reviewedCalled = true;
        throw new Error("reviewed source path must not run");
      },
    },
    queue: {},
    watcher: null,
    notifier: null,
    config: {
      adminToken,
      kgmuXlsxParserEnabled: true,
      kgmuXlsxMaxBytes: 1024,
    },
  });

  const req = request(Buffer.from("legacy"), "/api/v1/admin/kgmu/ingest?filename=test.xlsx&program=medicine&course=4", adminToken);
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(reviewedCalled, false);
  assert.equal(received.metadata.filename, "test.xlsx");
});
