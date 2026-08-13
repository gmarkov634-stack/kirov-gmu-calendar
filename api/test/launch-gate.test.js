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

const schedule = {
  version: 1,
  university: "omgmu",
  universityName: "ОмГМУ",
  program: "medicine",
  course: 4,
  stream: "2",
  group: {
    id: "omgmu:medicine:4:stream-2:Л-402А",
    code: "Л-402А",
    displayName: "Группа Л-402А",
  },
  timezone: "Asia/Omsk",
  academicYear: "2026-2027",
  semester: 1,
  sources: [{ url: "https://omsk-osma.ru/files/test.pdf" }],
  events: [{
    id: "omgmu-l402a-20260901",
    title: "Внутренние болезни",
    start: "2026-09-01T02:00:00.000Z",
    end: "2026-09-01T03:30:00.000Z",
    location: "Омск",
  }],
};

const validCheckout = {
  university: "omgmu",
  program: "medicine",
  course: 4,
  stream: "2",
  groupCode: "Л-402А",
  groupId: "omgmu:medicine:4:stream-2:Л-402А",
  email: "student@example.com",
  plan: "semester",
};

async function postCheckout(base, body = validCheckout) {
  return fetch(`${base}/api/v2/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("closed commercial gate blocks checkout before schedule lookup or payment provider", () => {
  let scheduleCalls = 0;
  let paymentCalls = 0;
  return withServer(createHandler({
    config: { commercialSalesEnabled: false },
    store: { getSchedule: async () => { scheduleCalls += 1; return schedule; } },
    payments: {
      enabled: true,
      create: async () => { paymentCalls += 1; return { confirmationUrl: "https://pay.test" }; },
    },
  }), async (base) => {
    const response = await postCheckout(base);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "sales_not_open" });
    assert.equal(scheduleCalls, 0);
    assert.equal(paymentCalls, 0);
  });
});

test("missing commercial gate is identical to closed", () => {
  let paymentCalls = 0;
  return withServer(createHandler({
    config: {},
    store: { getSchedule: async () => schedule },
    payments: {
      enabled: true,
      create: async () => { paymentCalls += 1; return { confirmationUrl: "https://pay.test" }; },
    },
  }), async (base) => {
    const response = await postCheckout(base);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "sales_not_open" });
    assert.equal(paymentCalls, 0);
  });
});

test("open commercial gate with published schedule reaches existing payment service", () => {
  let paymentCalls = 0;
  return withServer(createHandler({
    config: { commercialSalesEnabled: true },
    store: { getSchedule: async () => schedule },
    payments: {
      enabled: true,
      create: async ({ email, schedule: selected, plan }) => {
        paymentCalls += 1;
        assert.equal(email, "student@example.com");
        assert.equal(selected.group.code, "Л-402А");
        assert.equal(plan, "semester");
        return {
          orderId: "o".repeat(32),
          accessToken: "a".repeat(43),
          confirmationUrl: "https://pay.test",
        };
      },
    },
  }), async (base) => {
    const response = await postCheckout(base);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.confirmationUrl, "https://pay.test");
    assert.equal(paymentCalls, 1);
  });
});

test("open commercial gate never makes an unpublished group sellable", () => {
  let paymentCalls = 0;
  return withServer(createHandler({
    config: { commercialSalesEnabled: true },
    store: { getSchedule: async () => null },
    payments: {
      enabled: true,
      create: async () => { paymentCalls += 1; return { confirmationUrl: "https://pay.test" }; },
    },
  }), async (base) => {
    const response = await postCheckout(base);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "offer_not_found" });
    assert.equal(paymentCalls, 0);
  });
});

test("public metadata exposes only safe launch and payment mode state", async () => {
  await withServer(createHandler({ store: {}, config: { commercialSalesEnabled: false, yookassaTestMode: true } }), async (base) => {
    const response = await fetch(`${base}/api/v2/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sales, "closed");
    assert.equal(body.paymentMode, "test");
    assert.equal(Object.hasOwn(body, "yookassaShopId"), false);
    assert.equal(Object.hasOwn(body, "yookassaSecretKey"), false);
  });

  await withServer(createHandler({ store: {}, config: { commercialSalesEnabled: true, yookassaTestMode: false } }), async (base) => {
    const body = await (await fetch(`${base}/api/v2/meta`)).json();
    assert.equal(body.sales, "open");
    assert.equal(body.paymentMode, "live");
  });
});
