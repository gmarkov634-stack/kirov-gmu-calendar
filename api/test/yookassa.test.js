import assert from "node:assert/strict";
import test from "node:test";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  publicSiteUrl: "https://example.test/",
  publicApiUrl: "https://api.example.test",
  offerPrice: "490.00",
  offerExpiresAt: "2026-08-31T23:59:59+03:00",
  yookassaSendReceipt: true,
  receiptVatCode: 1,
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
  };
}

test("payment creation uses server offer and receipt data", async () => {
  const store = memoryStore();
  let request;
  const service = new YooKassaService({ config, store, fetchFn: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "payment_12345678",
      status: "pending",
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });

  const result = await service.create({
    group: "132",
    email: "student@example.com",
    schedule: { faculty: "pediatrics", course: 1, academicYear: "2025-2026", semester: 2 },
  });
  assert.equal(result.confirmationUrl, "https://yookassa.test/pay");
  assert.match(result.orderId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(request.body.amount.value, "490.00");
  assert.equal(request.body.metadata.order_id, result.orderId);
  assert.equal(request.body.receipt.customer.email, "student@example.com");
  assert.equal(request.body.receipt.items[0].payment_subject, "service");
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.ok(request.options.headers["Idempotence-Key"]);
});

test("verified succeeded payment creates one deterministic semester token", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, {
    version: 1,
    orderId,
    status: "pending",
    paymentId: "payment_12345678",
    group: "132",
    faculty: "pediatrics",
    course: 1,
    academicYear: "2025-2026",
    semester: 2,
    expiresAt: config.offerExpiresAt,
    amount: "490.00",
    currency: "RUB",
  });
  const payment = {
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    amount: { value: "490.00", currency: "RUB" },
    metadata: { order_id: orderId },
  };
  const service = new YooKassaService({ config, store, fetchFn: async () => new Response(JSON.stringify(payment), {
    status: 200,
    headers: { "content-type": "application/json" },
  }) });

  const first = await service.fulfillByPaymentId(payment.id);
  const second = await service.fulfillByPaymentId(payment.id);
  assert.equal(first.subscriptionUrl, second.subscriptionUrl);
  assert.equal(store.subscriptions.size, 1);
  const subscription = [...store.subscriptions.values()][0];
  assert.equal(subscription.group, "132");
  assert.equal(subscription.semester, 2);
  assert.equal(subscription.expiresAt, config.offerExpiresAt);
});

test("payment with altered amount cannot issue a subscription", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, { orderId, paymentId: "payment_12345678", amount: "490.00", currency: "RUB" });
  const service = new YooKassaService({ config, store });
  await assert.rejects(service.fulfill({
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    amount: { value: "1.00", currency: "RUB" },
    metadata: { order_id: orderId },
  }), /amount/);
  assert.equal(store.subscriptions.size, 0);
});
