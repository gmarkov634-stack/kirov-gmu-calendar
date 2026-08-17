import assert from "node:assert/strict";
import test from "node:test";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  yookassaTestMode: true,
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  universitySiteUrls: { izhgmu: "https://izhgmu.example.test/" },
  publicApiUrl: "https://api.example.test",
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
  yookassaSendReceipt: false,
};

const izhgmuSchedule = {
  version: 1,
  university: "izhgmu",
  universityName: "ИжГМУ",
  program: "medicine",
  course: 1,
  stream: "1",
  group: {
    id: "izhgmu:medicine:1:stream-1:101",
    code: "101",
    displayName: "Группа 101",
  },
  timezone: "Europe/Samara",
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

test("YooKassa service itself blocks IzhGMU checkout before storage or provider calls", async () => {
  const store = memoryStore();
  let providerCalls = 0;
  const service = new YooKassaService({
    config,
    store,
    fetchFn: async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    },
  });

  await assert.rejects(
    service.create({ email: "student@example.com", schedule: izhgmuSchedule, plan: "semester" }),
    (error) => error?.code === "university_commercial_not_open",
  );
  assert.equal(store.orders.size, 0);
  assert.equal(providerCalls, 0);
});

test("a valid already-created IzhGMU payment can still fulfill after the launch gate is closed", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, {
    version: 2,
    orderId,
    status: "pending",
    university: "izhgmu",
    universityName: "ИжГМУ",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: "101",
    groupId: "izhgmu:medicine:1:stream-1:101",
    groupDisplayName: "Группа 101",
    timezone: "Europe/Samara",
    academicYear: "2026-2027",
    semester: 1,
    plan: "semester",
    sku: "calendar:izhgmu:medicine:semester",
    expiresAt: "2027-01-31T20:59:59.000Z",
    amount: "299.00",
    currency: "RUB",
    testMode: true,
    paymentId: "payment_existing_izh",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const service = new YooKassaService({ config, store, fetchFn: async () => { throw new Error("not used"); } });
  const result = await service.fulfill({
    id: "payment_existing_izh",
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "299.00", currency: "RUB" },
    metadata: { order_id: orderId },
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.sku, "calendar:izhgmu:medicine:semester");
  assert.match(result.subscriptionUrl, /^https:\/\/api\.example\.test\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/);
  assert.equal(store.subscriptions.size, 1);
  const subscription = [...store.subscriptions.values()][0];
  assert.equal(subscription.university, "izhgmu");
  assert.equal(subscription.entitlement, "paid");
  assert.equal(subscription.sku, "calendar:izhgmu:medicine:semester");
});
