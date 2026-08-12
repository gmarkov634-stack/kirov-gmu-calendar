import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createArchivePaymentTestHandler } from "../src/archive-payment-test-handler.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function memoryStore(schedule) {
  const orders = new Map();
  const subscriptions = new Map();
  return {
    orders,
    subscriptions,
    getSchedule: async (context) => context.groupCode === schedule.group.code && context.academicYear === "2025/2026" && context.semester === 2
      ? structuredClone(schedule)
      : null,
    putOrder: async (id, value) => orders.set(id, structuredClone(value)),
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putSubscription: async (token, value) => subscriptions.set(token, structuredClone(value)),
    getSubscription: async (token) => structuredClone(subscriptions.get(token) || null),
  };
}

const adminToken = "a".repeat(40);
const archived = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  group: {
    id: "kgmu:pediatrics:1:132",
    code: "132",
    displayName: "Группа 132",
  },
  timezone: "Europe/Moscow",
  academicYear: "2025/26",
  semester: 2,
  sources: [{ url: "https://kirovgma.ru/archive.xlsx" }],
  events: [{
    id: "archive-event",
    start: "2026-05-10T10:00:00+03:00",
    end: "2026-05-10T11:30:00+03:00",
    title: "Педиатрия",
  }],
};

function config(overrides = {}) {
  return {
    adminToken,
    allowedOrigins: ["https://gmarkov634-stack.github.io"],
    yookassaShopId: "test-shop",
    yookassaSecretKey: "test-key",
    yookassaTestMode: true,
    subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
    universitySiteUrls: { kgmu: "https://kgmu.example.test" },
    publicApiUrl: "https://api.example.test",
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    offers: {
      semester: { id: "semester", price: "299.00" },
      year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
    },
    yookassaSendReceipt: false,
    receiptVatCode: 1,
    ...overrides,
  };
}

test("archived YooKassa test checkout is admin-only and creates a test year order without reopening public archive sales", () => {
  const store = memoryStore(archived);
  const payments = {
    enabled: true,
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.amount.value, "499.00");
      assert.match(body.description, /2025\/26/);
      return new Response(JSON.stringify({
        id: "archive_payment_123",
        status: "pending",
        test: true,
        confirmation: { confirmation_url: "https://yookassa.test/archive" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  const handler = createArchivePaymentTestHandler({ store, config: config(), payments });

  return withServer(handler, async (base) => {
    const body = JSON.stringify({
      email: "student@example.com",
      program: "pediatrics",
      course: 1,
      groupCode: "132",
      academicYear: "2025/26",
      semester: 2,
    });
    const forbidden = await fetch(`${base}/api/v1/admin/payments/test-archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(forbidden.status, 403);

    const response = await fetch(`${base}/api/v1/admin/payments/test-archive`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken },
      body,
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.testMode, true);
    assert.equal(result.confirmationUrl, "https://yookassa.test/archive");
    assert.equal(result.archive.academicYear, "2025/2026");
    const order = store.orders.get(result.orderId);
    assert.equal(order.academicYear, "2025/26");
    assert.equal(order.semester, 2);
    assert.equal(order.plan, "year");
    assert.equal(order.testMode, true);
  });
});

test("archived checkout refuses to run unless YooKassa test mode is enabled", () => {
  const store = memoryStore(archived);
  const payments = { enabled: true, fetch: async () => { throw new Error("must not call YooKassa"); } };
  const handler = createArchivePaymentTestHandler({ store, config: config({ yookassaTestMode: false }), payments });
  return withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v1/admin/payments/test-archive`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({
        email: "student@example.com",
        program: "pediatrics",
        course: 1,
        groupCode: "132",
        academicYear: "2025/26",
        semester: 2,
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "yookassa_test_mode_required" });
    assert.equal(store.orders.size, 0);
  });
});
