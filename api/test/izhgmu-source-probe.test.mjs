import assert from "node:assert/strict";
import test from "node:test";
import { createIzhgmuSourceProbeHandler } from "../src/adapters/izhgmu/source-probe.mjs";

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

function createFetchResponse(body, { contentType = "application/octet-stream", status = 200, url = "https://www.igma.ru/images/schedule.xlsx" } = {}) {
  const buffer = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({
      "content-type": contentType,
      "content-length": String(buffer.length),
    }),
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

async function run(handler, url) {
  const response = createResponseCapture();
  await handler({ method: "GET", url }, response);
  return response;
}

test("IzhGMU source probe recognizes XLSX/ZIP bytes", async () => {
  const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const handler = createIzhgmuSourceProbeHandler({ fetchFn: async () => createFetchResponse(xlsx) });
  const source = encodeURIComponent("https://www.igma.ru/images/schedule.xlsx");
  const response = await run(handler, `/api/v1/admin/izhgmu/source-probe?url=${source}`);
  const body = JSON.parse(response.body.toString("utf8"));
  assert.equal(response.statusCode, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.spreadsheetKind, "xlsx");
  assert.equal(body.isSpreadsheet, true);
});

test("IzhGMU source probe recognizes legacy XLS/OLE bytes", async () => {
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("payload")]);
  const handler = createIzhgmuSourceProbeHandler({ fetchFn: async () => createFetchResponse(xls, { url: "https://www.igma.ru/images/schedule.xls" }) });
  const source = encodeURIComponent("https://www.igma.ru/images/schedule.xls");
  const response = await run(handler, `/api/v1/admin/izhgmu/source-probe?url=${source}`);
  const body = JSON.parse(response.body.toString("utf8"));
  assert.equal(response.statusCode, 200);
  assert.equal(body.spreadsheetKind, "xls");
});

test("IzhGMU source probe never proxies HTML as a spreadsheet", async () => {
  const handler = createIzhgmuSourceProbeHandler({ fetchFn: async () => createFetchResponse("<html>error</html>", { contentType: "text/html" }) });
  const source = encodeURIComponent("https://www.igma.ru/images/schedule.xlsx");
  const response = await run(handler, `/api/v1/admin/izhgmu/source-probe?url=${source}&format=file`);
  const body = JSON.parse(response.body.toString("utf8"));
  assert.equal(response.statusCode, 422);
  assert.equal(body.status, "not_spreadsheet");
  assert.equal(body.isSpreadsheet, false);
});

test("IzhGMU source probe rejects non-IGMA hosts before fetch", async () => {
  const handler = createIzhgmuSourceProbeHandler({ fetchFn: async () => { throw new Error("must not fetch"); } });
  const source = encodeURIComponent("https://example.com/schedule.xlsx");
  const response = await run(handler, `/api/v1/admin/izhgmu/source-probe?url=${source}`);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body.toString("utf8")).error, "source_not_allowed");
});
