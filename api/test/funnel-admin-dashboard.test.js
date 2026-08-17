import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelSummary } from "../src/funnel-analytics.js";

const J1 = "1".repeat(64);
const J2 = "2".repeat(64);
const J3 = "3".repeat(64);

function event(journeyIdHash, name, overrides = {}) {
  return {
    version: 1,
    kind: "event",
    event: name,
    journeyIdHash,
    university: "kgmu",
    program: overrides.program ?? (name === "landing_view" || name === "university_view" ? null : "medicine"),
    course: overrides.course ?? (name === "landing_view" || name === "university_view" ? null : 1),
    groupCode: overrides.groupCode ?? (name === "landing_view" || name === "university_view" ? null : "101"),
    groupId: overrides.groupId ?? (name === "landing_view" || name === "university_view" ? null : "kgmu:medicine:1:101"),
    academicYear: "2026/2027",
    semester: 1,
    purchasePath: overrides.purchasePath ?? null,
    plan: overrides.plan ?? null,
    channel: overrides.channel ?? null,
    attribution: overrides.attribution ?? { source: null, medium: null, campaign: null, content: null, referral: null },
    createdAt: overrides.createdAt ?? "2026-09-09T12:00:00.000Z",
  };
}

function link(journeyIdHash, orderId, overrides = {}) {
  return {
    version: 1,
    kind: "link",
    linkType: "order",
    journeyIdHash,
    orderId,
    university: "kgmu",
    program: overrides.program ?? "medicine",
    course: overrides.course ?? 1,
    groupCode: overrides.groupCode ?? "101",
    groupId: overrides.groupId ?? "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
    createdAt: overrides.createdAt ?? "2026-09-09T12:03:00.000Z",
  };
}

function order(id, overrides = {}) {
  return {
    version: 2,
    orderId: id,
    status: "succeeded",
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
    plan: "semester",
    amount: "299.00",
    purchasePath: "direct_purchase",
    testMode: false,
    createdAt: "2026-09-09T12:02:00.000Z",
    updatedAt: "2026-09-09T12:04:00.000Z",
    ...overrides,
  };
}

test("admin dashboard aggregates live revenue, attribution, channels and demand", () => {
  const A = "A".repeat(32);
  const B = "B".repeat(32);
  const C = "C".repeat(32);
  const events = [
    event(J1, "landing_view", { attribution: { source: "vk" } }),
    event(J1, "group_selected"),
    event(J1, "checkout_started", { plan: "semester", purchasePath: "direct_purchase" }),
    event(J1, "paid_connect_clicked", { channel: "iphone" }),
    link(J1, A),
    event(J2, "landing_view"),
    event(J2, "group_selected", { program: "pediatrics", groupCode: "201", groupId: "kgmu:pediatrics:1:201" }),
    event(J2, "trial_connect_clicked", { program: "pediatrics", groupCode: "201", groupId: "kgmu:pediatrics:1:201", channel: "google" }),
    link(J2, B, { program: "pediatrics", groupCode: "201", groupId: "kgmu:pediatrics:1:201" }),
    event(J3, "landing_view", { createdAt: "2026-08-01T00:00:00.000Z", attribution: { source: "old" } }),
  ];
  const orders = [
    order(A),
    order(B, { program: "pediatrics", groupCode: "201", groupId: "kgmu:pediatrics:1:201", plan: "year", amount: "499.00", purchasePath: "trial_to_paid" }),
    order(C, { amount: "299.00", testMode: true }),
    order("D".repeat(32), { amount: "299.00", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:05:00.000Z" }),
  ];
  const accesses = [
    { tokenHash: "a".repeat(64), orderId: A, firstSeenAt: "2026-09-09T12:05:00.000Z" },
    { tokenHash: "b".repeat(64), orderId: B, firstSeenAt: "2026-09-09T12:06:00.000Z" },
  ];

  const result = buildFunnelSummary({
    orders,
    conversions: [],
    accesses,
    events,
    filter: { university: "kgmu", academicYear: "2026/27", semester: 1 },
    windowDays: 7,
    collectionEnabled: true,
    now: new Date("2026-09-10T12:00:00.000Z"),
  });

  assert.deepEqual(result.window, {
    days: 7,
    from: "2026-09-03T12:00:00.000Z",
    to: "2026-09-10T12:00:00.000Z",
  });
  assert.deepEqual(result.collection, { enabled: true, mode: "open" });
  assert.equal(result.commercial.live.orders, 2);
  assert.equal(result.commercial.live.revenueRub, 798);
  assert.equal(result.commercial.live.averageOrderRub, 399);
  assert.equal(result.commercial.live.connected, 2);
  assert.equal(result.commercial.test.orders, 1);
  assert.deepEqual(result.commercial.plans.semester, { orders: 1, revenueRub: 299 });
  assert.deepEqual(result.commercial.plans.year, { orders: 1, revenueRub: 499 });
  assert.deepEqual(result.commercial.purchasePaths.direct_purchase, { orders: 1, revenueRub: 299 });
  assert.deepEqual(result.commercial.purchasePaths.trial_to_paid, { orders: 1, revenueRub: 499 });
  assert.equal(result.segments.sources.find((row) => row.source === "vk")?.orders, 1);
  assert.equal(result.segments.sources.find((row) => row.source === "direct")?.orders, 1);
  assert.equal(result.segments.channels.paid.iphone, 1);
  assert.equal(result.segments.channels.trial.google, 1);
  assert.equal(result.segments.groups.find((row) => row.groupCode === "101")?.orders, 1);
  assert.equal(result.segments.groups.find((row) => row.groupCode === "201")?.orders, 1);
  assert.equal(result.upper.uniqueJourneys.landingView, 2);
  assert.equal(JSON.stringify(result).includes("email"), false);
  assert.equal(JSON.stringify(result).includes("subscriptionUrl"), false);
});
