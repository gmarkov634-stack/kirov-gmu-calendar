import assert from "node:assert/strict";
import test from "node:test";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  yookassaTestMode: true,
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  universitySiteUrls: { omgmu: "https://omgmu.example.test/" },
  publicApiUrl: "https://api.example.test",
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
  yookassaSendReceipt: false,
};

const schedule = {
  version: 1,
  university: "omgmu",
  universityName: "ОмГМУ",
  program: "medicine",
  course: 1,
  stream: "1",
  group: {
    id: "omgmu:medicine:1:stream-1:101",
    code: "101",
    displayName: "Группа 101",
  },
  timezone: "Asia/Omsk",
  academicYear: "2026-2027",
  semester: 1,
  sources: [],
  events: [{
    id: "class-1",
    start: "2026-12-01T05:00:00.000Z",
    end: "2026-12-01T06:30:00.000Z",
    title: "Анатомия",
  }],
};

function memoryStore() {
  const orders = new Map();
  const subscriptions = new Map();
  return {
    orders,
    subscriptions,
    putOrder: async (id, value) => orders.set(id, structuredClone(value)),
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putSubscription: async (token, value) => subscriptions.set(token, structuredClone(value)),
    getSubscription: async (token) => structuredClone(subscriptions.get(token) || null),
  };
}

test("YooKassa checkout persists the same server-owned SKU in order and payment metadata", async () => {
  const store = memoryStore();
  let requestBody;
  const service = new YooKassaService({
    config,
    store,
    fetchFn: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: "payment_sku_123",
        status: "pending",
        test: true,
        confirmation: { confirmation_url: "https://yookassa.test/pay" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await service.create({ email: "student@example.com", schedule, plan: "semester" });
  const order = store.orders.get(result.orderId);
  assert.equal(order.sku, "calendar:omgmu:medicine:semester");
  assert.equal(order.amount, "299.00");
  assert.equal(requestBody.metadata.sku, order.sku);
  assert.equal(requestBody.amount.value, order.amount);
});

test("paid subscription inherits immutable SKU from the stored order", async () => {
  const store = memoryStore();
  const service = new YooKassaService({
    config,
    store,
    fetchFn: async (_url, options) => new Response(JSON.stringify({
      id: "payment_sku_456",
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await service.create({ email: "student@example.com", schedule, plan: "semester" });
  const order = store.orders.get(result.orderId);
  await service.fulfill({
    id: order.paymentId,
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: order.amount, currency: order.currency },
    metadata: { order_id: result.orderId },
  });

  const subscription = [...store.subscriptions.values()][0];
  assert.equal(subscription.sku, "calendar:omgmu:medicine:semester");
  assert.equal(subscription.sku, order.sku);
});
