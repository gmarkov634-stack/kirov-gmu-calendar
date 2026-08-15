import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { orderLinkRecordKey, recordFunnelEvent, trialLinkRecordKey } from "../src/funnel-events.js";

const JOURNEY_A = "a".repeat(32);
const JOURNEY_B = "b".repeat(32);
const CONVERSION_ID = "C".repeat(43);
const ORDER_ID = "O".repeat(32);

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function config(overrides = {}) {
  return {
    funnelAnalyticsEnabled: true,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    journeyId: JOURNEY_A,
    event: "group_selected",
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/27",
    semester: 1,
    source: "vk",
    campaign: " launch ",
    ...overrides,
  };
}

function fakeStore() {
  const records = new Map();
  const conversions = new Map();
  const orders = new Map();
  return {
    records,
    conversions,
    orders,
    async putFunnelRecord(key, value) { records.set(key, structuredClone(value)); },
    async getFunnelRecord(key) { return records.get(key) || null; },
    async getTrialConversion(id) { return conversions.get(id) || null; },
    async getOrder(id) { return orders.get(id) || null; },
  };
}

test("browser event stores only hashed journey id and is idempotent", async () => {
  const store = fakeStore();
  await recordFunnelEvent({
    store,
    config: config(),
    input: baseInput(),
    now: () => new Date("2026-08-15T12:00:00.000Z"),
  });
  await recordFunnelEvent({
    store,
    config: config(),
    input: baseInput(),
    now: () => new Date("2026-08-15T12:01:00.000Z"),
  });

  assert.equal(store.records.size, 1);
  const [record] = store.records.values();
  assert.equal(record.journeyIdHash, sha(JOURNEY_A));
  assert.equal(record.attribution.source, "vk");
  assert.equal(record.attribution.campaign, "launch");
  assert.equal(record.createdAt, "2026-08-15T12:01:00.000Z");
  assert.equal(JSON.stringify(record).includes(JOURNEY_A), false);
  assert.equal(Object.hasOwn(record, "journeyId"), false);
});

test("browser event rejects wrong offer period and closed gate", async () => {
  const store = fakeStore();
  await assert.rejects(
    recordFunnelEvent({ store, config: config(), input: baseInput({ semester: 2 }) }),
    (error) => error.code === "analytics_period_mismatch",
  );
  await assert.rejects(
    recordFunnelEvent({ store, config: config({ funnelAnalyticsEnabled: false }), input: baseInput() }),
    (error) => error.code === "analytics_not_open",
  );
  assert.equal(store.records.size, 0);
});

test("trial bridge verifies conversion and stores no raw conversion or journey id", async () => {
  const store = fakeStore();
  const conversionHash = sha(CONVERSION_ID);
  store.conversions.set(CONVERSION_ID, {
    version: 1,
    status: "active",
    conversionIdHash: conversionHash,
    trialTokenHash: "d".repeat(64),
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
  });

  await recordFunnelEvent({
    store,
    config: config(),
    input: { journeyId: JOURNEY_A, event: "trial_linked", conversionId: CONVERSION_ID },
  });

  const record = store.records.get(trialLinkRecordKey(conversionHash));
  assert.equal(record.linkType, "trial");
  assert.equal(record.journeyIdHash, sha(JOURNEY_A));
  assert.equal(record.conversionIdHash, conversionHash);
  assert.equal(JSON.stringify(record).includes(CONVERSION_ID), false);
  assert.equal(JSON.stringify(record).includes(JOURNEY_A), false);
});

test("trial-to-paid order bridge reuses original trial journey when linkage matches", async () => {
  const store = fakeStore();
  const conversionHash = sha(CONVERSION_ID);
  store.conversions.set(CONVERSION_ID, {
    version: 1,
    status: "active",
    conversionIdHash: conversionHash,
    trialTokenHash: "d".repeat(64),
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
  });
  await recordFunnelEvent({
    store,
    config: config(),
    input: { journeyId: JOURNEY_A, event: "trial_linked", conversionId: CONVERSION_ID },
  });

  store.orders.set(ORDER_ID, {
    version: 2,
    orderId: ORDER_ID,
    status: "pending",
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
    purchasePath: "trial_to_paid",
    plan: "year",
    trialConversionHash: conversionHash,
  });

  await recordFunnelEvent({
    store,
    config: config(),
    input: { journeyId: JOURNEY_B, event: "order_linked", orderId: ORDER_ID, conversionId: CONVERSION_ID },
  });

  const record = store.records.get(orderLinkRecordKey(ORDER_ID));
  assert.equal(record.linkType, "order");
  assert.equal(record.journeyIdHash, sha(JOURNEY_A));
  assert.equal(record.purchasePath, "trial_to_paid");
  assert.equal(record.plan, "year");
});

test("direct order bridge uses current session journey", async () => {
  const store = fakeStore();
  store.orders.set(ORDER_ID, {
    version: 2,
    orderId: ORDER_ID,
    status: "pending",
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
    purchasePath: "direct_purchase",
    plan: "semester",
  });

  await recordFunnelEvent({
    store,
    config: config(),
    input: { journeyId: JOURNEY_B, event: "order_linked", orderId: ORDER_ID },
  });

  const record = store.records.get(orderLinkRecordKey(ORDER_ID));
  assert.equal(record.journeyIdHash, sha(JOURNEY_B));
  assert.equal(record.purchasePath, "direct_purchase");
});
