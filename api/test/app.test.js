import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const config = {
  allowedOrigin: "https://example.test",
  publicSiteUrl: "https://example.test/",
  enablePublicEndpoints: false,
  commercialSalesEnabled: true,
};

async function postCheckout(base, body) {
  const response = await fetch(`${base}/api/v2/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("health endpoint identifies the shared service", () => withServer(
  createHandler({ store: {}, config }),
  async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "medical-calendar-api" });
  },
));

test("version 2 metadata describes the shared platform", () => withServer(
  createHandler({ store: {}, config }),
  async (base) => {
    const response = await fetch(`${base}/api/v2/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.version, 2);
    assert.match(body.service, /медицинских вузов/);
  },
));

test("checkout rejects an incomplete university context", () => withServer(
  createHandler({
    store: { getSchedule: async () => null },
    config: { ...config, offerExpiresAt: "2999-08-31T23:59:59+03:00" },
    payments: { enabled: true },
  }),
  async (base) => {
    const { response, body } = await postCheckout(base, { university: "omgmu", email: "student@example.com" });
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: "invalid_checkout" });
  },
));

test("UGMU checkout rejects groups outside the reviewed course-1 catalog before storage lookup", () => {
  let scheduleReads = 0;
  return withServer(
    createHandler({
      store: { getSchedule: async () => { scheduleReads += 1; return null; } },
      config: { ...config, offerExpiresAt: "2999-08-31T23:59:59+03:00" },
      payments: { enabled: true },
    }),
    async (base) => {
      const { response, body } = await postCheckout(base, {
        university_id: "ugmu",
        program: "medicine",
        course: 1,
        stream: "4",
        groupCode: "ОЛД 151",
        groupId: "ugmu:medicine:1:stream-4:ОЛД 151",
        email: "student@example.com",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(body, { error: "invalid_checkout" });
      assert.equal(scheduleReads, 0);
    },
  );
});

test("UGMU checkout accepts an exact reviewed context and reaches schedule availability", () => {
  let scheduleReads = 0;
  return withServer(
    createHandler({
      store: { getSchedule: async () => { scheduleReads += 1; return null; } },
      config: { ...config, offerExpiresAt: "2999-08-31T23:59:59+03:00" },
      payments: { enabled: true },
    }),
    async (base) => {
      const { response, body } = await postCheckout(base, {
        university_id: "ugmu",
        program: "medicine",
        course: 1,
        stream: "4",
        groupCode: "ОЛД 150",
        groupId: "ugmu:medicine:1:stream-4:ОЛД 150",
        email: "student@example.com",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(body, { error: "offer_not_found" });
      assert.equal(scheduleReads, 1);
    },
  );
});

test("legacy public group route is no longer exposed", () => withServer(
  createHandler({ store: {}, config: { ...config, enablePublicEndpoints: true } }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/groups/132/schedule`);
    assert.equal(response.status, 404);
  },
));
