import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/app.js";

function request(url) {
  return { method: "GET", url, headers: {}, async *[Symbol.asyncIterator]() {} };
}

function response() {
  return {
    status: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(value = "") {
      this.body = value ? JSON.parse(value) : null;
    },
  };
}

const config = {
  commercialSalesEnabled: false,
  trialsEnabled: false,
  yookassaTestMode: true,
  allowedOrigins: [],
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
};

test("unscoped meta keeps the legacy price-only offer shape", async () => {
  const handler = createHandler({ config, store: {}, payments: { enabled: true } });
  const res = response();
  await handler(request("/api/v2/meta"), res);
  assert.deepEqual(res.body.offers, {
    semester: { price: "299.00" },
    year: { price: "499.00" },
  });
  assert.equal(res.body.program, undefined);
});

test("university and program scoped meta exposes stable server-owned SKUs", async () => {
  const handler = createHandler({ config, store: {}, payments: { enabled: true } });
  const res = response();
  await handler(request("/api/v2/meta?university=izhgmu&program=medicine"), res);
  assert.equal(res.status, 200);
  assert.equal(res.body.university, "izhgmu");
  assert.equal(res.body.program, "medicine");
  assert.equal(res.body.universityCommercial, "closed");
  assert.deepEqual(res.body.offers, {
    semester: { price: "299.00", sku: "calendar:izhgmu:medicine:semester" },
    year: { price: "499.00", sku: "calendar:izhgmu:medicine:year" },
  });
});

test("university-only scoped meta remains backward compatible without SKU fields", async () => {
  const handler = createHandler({ config, store: {}, payments: { enabled: true } });
  const res = response();
  await handler(request("/api/v2/meta?university=izhgmu"), res);
  assert.equal(res.body.university, "izhgmu");
  assert.equal(res.body.universityCommercial, "closed");
  assert.deepEqual(res.body.offers, {
    semester: { price: "299.00" },
    year: { price: "499.00" },
  });
  assert.equal(res.body.program, undefined);
});
