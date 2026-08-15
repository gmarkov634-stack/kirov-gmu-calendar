import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCalendar } from "../src/calendar.js";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  yookassaTestMode: true,
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  universitySiteUrls: { kgmu: "https://kgmu.example.test/" },
  publicApiUrl: "https://api.example.test",
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
  yookassaSendReceipt: false,
  receiptVatCode: 1,
};

const schedule = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  stream: null,
  group: {
    id: "kgmu:pediatrics:1:131",
    code: "131",
    displayName: "Группа 131",
  },
  timezone: "Europe/Moscow",
  academicYear: "2026-2027",
  semester: 1,
  events: [
    { id: "class-1", start: "2026-09-01T09:00:00+03:00", end: "2026-09-01T10:30:00+03:00", title: "Педиатрия" },
    { id: "class-2", start: "2026-12-20T09:00:00+03:00", end: "2026-12-20T10:30:00+03:00", title: "Педиатрия" },
  ],
};

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function storeWithTrial(conversionId, trialOverrides = {}) {
  const orders = new Map();
  const subscriptions = new Map();
  const conversions = new Map();
  const revokedHashes = [];
  const upgradedHashes = [];
  const trialToken = "t".repeat(43);
  conversions.set(conversionId, {
    version: 1,
    status: "active",
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    stream: null,
    groupCode: "131",
    groupId: "kgmu:pediatrics:1:131",
    groupDisplayName: "Группа 131",
    timezone: "Europe/Moscow",
    academicYear: "2026/2027",
    semester: 1,
    trialStartDate: "2026-09-01",
    trialEndDateExclusive: "2026-09-08",
    trialTokenHash: sha(trialToken),
    attribution: { source: "vk", campaign: "fall-2026" },
    ...trialOverrides,
  });
  return {
    orders,
    subscriptions,
    conversions,
    revokedHashes,
    upgradedHashes,
    trialToken,
    async putOrder(id, value) { orders.set(id, structuredClone(value)); },
    async getOrder(id) { return structuredClone(orders.get(id) || null); },
    async putSubscription(token, value) { subscriptions.set(token, structuredClone(value)); },
    async getSubscription(token) { return structuredClone(subscriptions.get(token) || null); },
    async getTrialConversion(id) { return structuredClone(conversions.get(id) || null); },
    async revokeSubscriptionByHash(hash) { revokedHashes.push(hash); return { status: "revoked" }; },
    async markTrialConversionUpgradedByHash(hash, upgradedAt) {
      upgradedHashes.push(hash);
      const current = conversions.get(conversionId);
      conversions.set(conversionId, { ...current, status: "upgraded", upgradedAt });
      return structuredClone(conversions.get(conversionId));
    },
  };
}

test("trial checkout stores only hashes and fulfillment creates full paid entitlement then retires trial", async () => {
  const conversionId = "c".repeat(43);
  const store = storeWithTrial(conversionId);
  const paymentId = "payment_trial_paid_123";
  const service = new YooKassaService({
    config,
    store,
    fetchFn: async () => new Response(JSON.stringify({
      id: paymentId,
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const created = await service.create({
    email: "student@example.com",
    schedule,
    conversionId,
  });
  const order = store.orders.get(created.orderId);
  assert.equal(order.purchasePath, "trial_to_paid");
  assert.equal(order.trialConversionHash, sha(conversionId));
  assert.equal(order.trialTokenHash, sha(store.trialToken));
  assert.equal(JSON.stringify(order).includes(conversionId), false);
  assert.equal(order.attribution.campaign, "fall-2026");

  const result = await service.fulfill({
    id: paymentId,
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "299.00", currency: "RUB" },
    metadata: { order_id: created.orderId },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.purchasePath, "trial_to_paid");
  assert.equal(store.subscriptions.size, 1);
  const paid = [...store.subscriptions.values()][0];
  assert.equal(paid.entitlement, "paid");
  assert.equal(paid.status, "active");
  assert.equal(paid.groupId, "kgmu:pediatrics:1:131");
  assert.equal(paid.expiresAt, "2026-12-20T07:30:00.000Z");
  assert.equal("trialStartDate" in paid, false);
  assert.equal("trialEndDateExclusive" in paid, false);

  // The purchased calendar remains self-contained: the same paid builder sees
  // both the first-week event and a later semester event.
  const paidCalendar = buildCalendar(schedule, "https://kgmu.example.test/");
  assert.match(paidCalendar, /UID:class-1@kgmu-calendar/);
  assert.match(paidCalendar, /UID:class-2@kgmu-calendar/);

  assert.deepEqual(store.revokedHashes, [sha(store.trialToken)]);
  assert.deepEqual(store.upgradedHashes, [sha(conversionId)]);
  assert.equal(store.conversions.get(conversionId).status, "upgraded");

  // Fulfillment retry remains idempotent and retries trial cleanup without
  // creating a second paid subscription.
  await service.fulfill({
    id: paymentId,
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "299.00", currency: "RUB" },
    metadata: { order_id: created.orderId },
  });
  assert.equal(store.subscriptions.size, 1);
  assert.equal(store.revokedHashes.length, 2);
});

test("trial conversion for another group cannot be attached to checkout", async () => {
  const conversionId = "d".repeat(43);
  const store = storeWithTrial(conversionId, { groupId: "kgmu:pediatrics:1:132", groupCode: "132" });
  let fetchCalled = false;
  const service = new YooKassaService({
    config,
    store,
    fetchFn: async () => {
      fetchCalled = true;
      throw new Error("must not call YooKassa");
    },
  });

  await assert.rejects(
    service.create({ email: "student@example.com", schedule, conversionId }),
    (error) => error.code === "trial_context_invalid",
  );
  assert.equal(fetchCalled, false);
  assert.equal(store.orders.size, 0);
});
