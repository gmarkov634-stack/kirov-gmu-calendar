import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelSummary, createFunnelAnalyticsHandler } from "../src/funnel-analytics.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function order(orderId, overrides = {}) {
  return {
    version: 2,
    orderId,
    status: "succeeded",
    university: "kgmu",
    academicYear: "2026/2027",
    semester: 1,
    purchasePath: "direct_purchase",
    testMode: true,
    ...overrides,
  };
}

function conversion(hash, overrides = {}) {
  return {
    version: 1,
    status: "active",
    university: "kgmu",
    academicYear: "2026/2027",
    semester: 1,
    trialTokenHash: hash,
    ...overrides,
  };
}

test("funnel summary joins trial and paid first-fetch facts without raw personal data", () => {
  const orders = [
    order("A".repeat(32), { purchasePath: "trial_to_paid" }),
    order("B".repeat(32)),
    order("C".repeat(32), { testMode: false }),
    order("D".repeat(32), { academicYear: "2025/2026" }),
  ];
  const conversions = [
    conversion(HASH_A, { status: "upgraded" }),
    conversion(HASH_B),
    conversion("c".repeat(64), { semester: 2 }),
  ];
  const accesses = [
    { tokenHash: HASH_A, orderId: null, firstSeenAt: "2026-09-01T06:00:00.000Z" },
    { tokenHash: "d".repeat(64), orderId: "A".repeat(32), firstSeenAt: "2026-09-02T06:00:00.000Z" },
    { tokenHash: "e".repeat(64), orderId: "C".repeat(32), firstSeenAt: "2026-09-03T06:00:00.000Z" },
  ];

  const result = buildFunnelSummary({
    orders,
    conversions,
    accesses,
    filter: { university: "kgmu", academicYear: "2026/27", semester: 1 },
    now: new Date("2026-09-10T10:00:00.000Z"),
  });

  assert.deepEqual(result.trial, {
    created: 2,
    connected: 1,
    upgraded: 1,
    connectRate: 0.5,
    upgradeRateFromCreated: 0.5,
    upgradeRateFromConnected: 1,
  });
  assert.equal(result.payments.all.paymentSucceeded, 3);
  assert.equal(result.payments.all.trialToPaidSucceeded, 1);
  assert.equal(result.payments.all.directPurchaseSucceeded, 2);
  assert.equal(result.payments.all.paidConnected, 2);
  assert.equal(result.payments.all.paidConnectRate, 0.6667);
  assert.equal(result.payments.all.trialToPaidRateFromConnectedTrial, 1);
  assert.equal(result.payments.test.paymentSucceeded, 2);
  assert.equal(result.payments.test.paidConnected, 1);
  assert.equal(result.payments.test.paidConnectRate, 0.5);
  assert.equal(result.payments.live.paymentSucceeded, 1);
  assert.equal(result.payments.live.paidConnected, 1);
  assert.equal(JSON.stringify(result).includes("email"), false);
});

function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
}

test("admin funnel endpoint is protected and defaults to current offer period", async () => {
  const config = {
    adminToken: "x".repeat(32),
    offerAcademicYear: "2026/27",
    offerSemester: 1,
  };
  const store = {
    async listFunnelOrders() { return [order("A".repeat(32))]; },
    async listTrialConversions() { return [conversion(HASH_A)]; },
    async listSubscriptionAccess() { return []; },
  };
  const handler = createFunnelAnalyticsHandler({ store, config, now: () => new Date("2026-09-10T10:00:00.000Z") });

  const forbidden = fakeResponse();
  await handler({ method: "GET", url: "/api/v1/admin/funnel", headers: {} }, forbidden);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(JSON.parse(forbidden.body), { error: "admin_forbidden" });

  const allowed = fakeResponse();
  await handler({
    method: "GET",
    url: "/api/v1/admin/funnel?university=kgmu",
    headers: { "x-admin-token": config.adminToken },
  }, allowed);
  assert.equal(allowed.status, 200);
  const body = JSON.parse(allowed.body);
  assert.deepEqual(body.filter, { university: "kgmu", academicYear: "2026/2027", semester: 1 });
  assert.equal(body.payments.test.paymentSucceeded, 1);
});
