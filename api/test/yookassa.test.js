import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  yookassaTestMode: true,
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  publicSiteUrl: "https://example.test/",
  publicApiUrl: "https://api.example.test",
  offerPrice: "490.00",
  offerExpiresAt: "2027-07-01T00:00:00+06:00",
  yookassaSendReceipt: true,
  receiptVatCode: 1,
};

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
  events: [],
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

test("payment creation stores the complete university context", async () => {
  const store = memoryStore();
  let request;
  const service = new YooKassaService({ config, store, fetchFn: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "payment_12345678",
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });

  const result = await service.create({ email: "student@example.com", schedule });
  const order = store.orders.get(result.orderId);
  assert.equal(result.confirmationUrl, "https://yookassa.test/pay");
  assert.equal(order.version, 2);
  assert.equal(order.university, "omgmu");
  assert.equal(order.groupCode, "Л-402А");
  assert.equal(order.groupId, "omgmu:medicine:4:stream-2:Л-402А");
  assert.equal(order.accessTokenHash, createHash("sha256").update(result.accessToken).digest("hex"));
  assert.equal(request.body.metadata.university, "omgmu");
  assert.equal(request.body.metadata.group_id, order.groupId);
  assert.match(request.body.description, /ОмГМУ/);
});

test("succeeded payment creates a version 2 subscription", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, {
    version: 2,
    orderId,
    status: "pending",
    paymentId: "payment_12345678",
    ...{
      university: "omgmu",
      universityName: "ОмГМУ",
      program: "medicine",
      course: 4,
      stream: "2",
      groupCode: "Л-402А",
      groupId: "omgmu:medicine:4:stream-2:Л-402А",
      groupDisplayName: "Группа Л-402А",
      timezone: "Asia/Omsk",
      academicYear: "2026-2027",
      semester: 1,
    },
    expiresAt: config.offerExpiresAt,
    amount: "490.00",
    currency: "RUB",
  });
  const payment = {
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    test: true,
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
  assert.equal(subscription.version, 2);
  assert.equal(subscription.university, "omgmu");
  assert.equal(subscription.groupCode, "Л-402А");
  assert.equal(subscription.timezone, "Asia/Omsk");
});

test("altered payment amount cannot issue a subscription", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, { orderId, paymentId: "payment_12345678", amount: "490.00", currency: "RUB" });
  const service = new YooKassaService({ config, store });
  await assert.rejects(service.fulfill({
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "1.00", currency: "RUB" },
    metadata: { order_id: orderId },
  }), /amount/);
  assert.equal(store.subscriptions.size, 0);
});

test("protected order requires its access token", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  const accessToken = "a".repeat(43);
  await store.putOrder(orderId, {
    orderId,
    status: "succeeded",
    university: "omgmu",
    program: "medicine",
    course: 4,
    stream: "2",
    groupCode: "Л-402А",
    groupId: "omgmu:medicine:4:stream-2:Л-402А",
    groupDisplayName: "Группа Л-402А",
    accessTokenHash: createHash("sha256").update(accessToken).digest("hex"),
    subscriptionUrl: "https://api.example.test/api/v1/subscriptions/" + "s".repeat(43) + "/calendar.ics",
  });
  const service = new YooKassaService({ config, store });
  await assert.rejects(service.getOrder(orderId, { reconcile: false }), /access denied/);
  const order = await service.getOrder(orderId, { reconcile: false, accessToken });
  assert.equal(order.university, "omgmu");
  assert.equal(order.groupCode, "Л-402А");
});
