import assert from "node:assert/strict";
import test from "node:test";
import { createOmgmuSourceProbeHandler } from "../src/adapters/omgmu/source-probe.mjs";

function createResponseCapture() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: Buffer.alloc(0),
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    end(chunk = "") {
      this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    },
  };
}

function createFetchResponse(body, { contentType = "application/pdf", status = 200 } = {}) {
  const buffer = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf",
    headers: new Headers({
      "content-type": contentType,
      "content-length": String(buffer.length),
    }),
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

test("OmGMU source probe returns verified PDF bytes in pdf format", async () => {
  const pdf = Buffer.from("%PDF-1.7\nverified-source\n%%EOF\n");
  const handler = createOmgmuSourceProbeHandler({
    fetchFn: async () => createFetchResponse(pdf),
  });
  const response = createResponseCapture();
  const source = encodeURIComponent("https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf");

  await handler({
    method: "GET",
    url: `/api/v1/admin/omgmu/source-probe?url=${source}&format=pdf`,
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(pdf.length));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(response.body, pdf);
});

test("OmGMU source probe never proxies a non-PDF response as PDF", async () => {
  const handler = createOmgmuSourceProbeHandler({
    fetchFn: async () => createFetchResponse("<html>not a pdf</html>", { contentType: "text/html" }),
  });
  const response = createResponseCapture();
  const source = encodeURIComponent("https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf");

  await handler({
    method: "GET",
    url: `/api/v1/admin/omgmu/source-probe?url=${source}&format=pdf`,
  }, response);

  assert.equal(response.statusCode, 422);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const body = JSON.parse(response.body.toString("utf8"));
  assert.equal(body.status, "not_pdf");
  assert.equal(body.isPdf, false);
});

test("OmGMU source probe rejects unsupported proxy formats", async () => {
  const handler = createOmgmuSourceProbeHandler({ fetchFn: async () => { throw new Error("must not fetch"); } });
  const response = createResponseCapture();
  const source = encodeURIComponent("https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf");

  await handler({
    method: "GET",
    url: `/api/v1/admin/omgmu/source-probe?url=${source}&format=html`,
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body.toString("utf8")).error, "invalid_format");
});
