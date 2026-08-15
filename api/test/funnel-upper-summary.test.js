import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelSummary } from "../src/funnel-analytics.js";

const J1 = "1".repeat(64);
const J2 = "2".repeat(64);
const CONVERSION_HASH = "c".repeat(64);
const TRIAL_TOKEN_HASH = "t".repeat(64).replaceAll("t", "a");
const PAID_TOKEN_HASH = "p".repeat(64).replaceAll("p", "b");
const ORDER_ID = "O".repeat(32);

function context(overrides = {}) {
  return {
    university: "kgmu",
    program: "medicine",
    course: 1,
    groupCode: "101",
    groupId: "kgmu:medicine:1:101",
    academicYear: "2026/2027",
    semester: 1,
    ...overrides,
  };
}

function event(name, journeyIdHash = J1, overrides = {}) {
  return {
    version: 1,
    kind: "event",
    event: name,
    journeyIdHash,
    ...context(),
    ...overrides,
  };
}

test("upper funnel counts unique journeys and links real trial/payment connections", () => {
  const events = [
    event("landing_view", J1, { program: null, course: null, groupCode: null, groupId: null }),
    event("university_view", J1, { program: null, course: null, groupCode: null, groupId: null }),
    event("group_selected"),
    event("trial_cta_clicked"),
    event("trial_connect_clicked", J1, { channel: "iphone" }),
    event("offer_view", J2),
    event("checkout_started", J2),
    event("paid_link_shown", J2),
    event("paid_connect_clicked", J2, { channel: "google" }),
    {
      version: 1,
      kind: "link",
      linkType: "trial",
      journeyIdHash: J1,
      conversionIdHash: CONVERSION_HASH,
      ...context(),
    },
    {
      version: 1,
      kind: "link",
      linkType: "order",
      journeyIdHash: J1,
      orderId: ORDER_ID,
      purchasePath: "trial_to_paid",
      plan: "year",
      ...context(),
    },
  ];
  const conversions = [{
    version: 1,
    status: "upgraded",
    conversionIdHash: CONVERSION_HASH,
    trialTokenHash: TRIAL_TOKEN_HASH,
    ...context(),
  }];
  const orders = [{
    version: 2,
    orderId: ORDER_ID,
    status: "succeeded",
    purchasePath: "trial_to_paid",
    plan: "year",
    testMode: true,
    ...context(),
  }];
  const accesses = [
    { tokenHash: TRIAL_TOKEN_HASH, firstSeenAt: "2026-09-01T08:00:00.000Z", orderId: null },
    { tokenHash: PAID_TOKEN_HASH, firstSeenAt: "2026-09-02T08:00:00.000Z", orderId: ORDER_ID },
  ];

  const result = buildFunnelSummary({
    orders,
    conversions,
    accesses,
    events,
    filter: { university: "kgmu", academicYear: "2026/27", semester: 1 },
    now: new Date("2026-09-03T00:00:00.000Z"),
  });

  assert.equal(result.version, 2);
  assert.deepEqual(result.upper.uniqueJourneys, {
    landingView: 1,
    universityView: 1,
    groupSelected: 1,
    trialCtaClicked: 1,
    directPurchaseClicked: 0,
    trialConnectClicked: 1,
    offerView: 1,
    checkoutStarted: 1,
    paidLinkShown: 1,
    paidConnectClicked: 1,
  });
  assert.deepEqual(result.upper.linkedServerFacts, {
    trialCreated: 1,
    trialConnected: 1,
    paymentSucceeded: 1,
    trialToPaidSucceeded: 1,
    paidConnected: 1,
  });
  assert.deepEqual(result.upper.linkCoverage, { trialCreated: 1, paymentSucceeded: 1 });
  assert.equal(result.upper.rates.landingToGroupSelected, 1);
  assert.equal(result.upper.rates.groupSelectedToTrialCreated, 1);
  assert.equal(result.upper.rates.trialCreatedToConnected, 1);
  assert.equal(result.upper.rates.connectedTrialToPaid, 1);
  assert.equal(result.upper.rates.checkoutToPayment, 1);
  assert.equal(result.upper.rates.paymentToPaidConnected, 1);
  assert.equal(result.upper.rates.landingToPaidConnected, 1);
  assert.equal(result.trial.created, 1);
  assert.equal(result.trial.connected, 1);
  assert.equal(result.payments.test.paymentSucceeded, 1);
  assert.equal(result.payments.live.paymentSucceeded, 0);
});

test("upper funnel ignores events outside requested period", () => {
  const result = buildFunnelSummary({
    events: [
      event("landing_view", J1, { academicYear: "2025/2026" }),
      event("landing_view", J2, { semester: 2 }),
    ],
    filter: { university: "kgmu", academicYear: "2026/27", semester: 1 },
  });
  assert.equal(result.upper.uniqueJourneys.landingView, 0);
});
