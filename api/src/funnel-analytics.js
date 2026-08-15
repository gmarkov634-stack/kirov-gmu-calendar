import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeAcademicYear } from "./order-context.js";

const SHA256 = /^[a-f0-9]{64}$/;

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function samePeriod(value, filter) {
  if (filter.university && value?.university !== filter.university) return false;
  if (filter.academicYear) {
    if (normalizeAcademicYear(value?.academicYear) !== normalizeAcademicYear(filter.academicYear)) return false;
  }
  if (filter.semester && Number(value?.semester) !== Number(filter.semester)) return false;
  return true;
}

function paymentBucket(orders, connectedOrderIds, testMode) {
  const succeeded = orders.filter((order) => order?.status === "succeeded" && order?.testMode === testMode);
  const trialToPaid = succeeded.filter((order) => order.purchasePath === "trial_to_paid");
  const direct = succeeded.filter((order) => order.purchasePath !== "trial_to_paid");
  const connected = succeeded.filter((order) => connectedOrderIds.has(order.orderId));
  const trialConnected = trialToPaid.filter((order) => connectedOrderIds.has(order.orderId));
  const directConnected = direct.filter((order) => connectedOrderIds.has(order.orderId));

  return {
    paymentSucceeded: succeeded.length,
    trialToPaidSucceeded: trialToPaid.length,
    directPurchaseSucceeded: direct.length,
    paidConnected: connected.length,
    trialToPaidConnected: trialConnected.length,
    directPurchaseConnected: directConnected.length,
    paidConnectRate: ratio(connected.length, succeeded.length),
    trialToPaidConnectRate: ratio(trialConnected.length, trialToPaid.length),
    directPurchaseConnectRate: ratio(directConnected.length, direct.length),
  };
}

export function buildFunnelSummary({ orders = [], conversions = [], accesses = [], filter = {}, now = new Date() } = {}) {
  const periodFilter = {
    university: filter.university || null,
    academicYear: normalizeAcademicYear(filter.academicYear) || null,
    semester: Number(filter.semester) || null,
  };

  const filteredOrders = orders.filter((value) => samePeriod(value, periodFilter));
  const filteredConversions = conversions.filter((value) => samePeriod(value, periodFilter));
  const accessByHash = new Map(
    accesses
      .filter((value) => SHA256.test(String(value?.tokenHash || "")))
      .map((value) => [value.tokenHash, value]),
  );
  const connectedOrderIds = new Set(
    accesses
      .filter((value) => value?.orderId && value?.firstSeenAt)
      .map((value) => value.orderId),
  );

  const trialCreated = filteredConversions.length;
  const connectedTrialConversions = filteredConversions.filter((conversion) => {
    if (!SHA256.test(String(conversion?.trialTokenHash || ""))) return false;
    return Boolean(accessByHash.get(conversion.trialTokenHash)?.firstSeenAt);
  });
  const trialConnected = connectedTrialConversions.length;
  const upgradedConversions = filteredConversions.filter((conversion) => conversion?.status === "upgraded");

  const allPayments = {
    paymentSucceeded: filteredOrders.filter((order) => order?.status === "succeeded").length,
    trialToPaidSucceeded: filteredOrders.filter((order) => order?.status === "succeeded" && order.purchasePath === "trial_to_paid").length,
    directPurchaseSucceeded: filteredOrders.filter((order) => order?.status === "succeeded" && order.purchasePath !== "trial_to_paid").length,
    paidConnected: filteredOrders.filter((order) => order?.status === "succeeded" && connectedOrderIds.has(order.orderId)).length,
  };

  return {
    version: 1,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    filter: periodFilter,
    trial: {
      created: trialCreated,
      connected: trialConnected,
      upgraded: upgradedConversions.length,
      connectRate: ratio(trialConnected, trialCreated),
      upgradeRateFromCreated: ratio(upgradedConversions.length, trialCreated),
      upgradeRateFromConnected: ratio(upgradedConversions.length, trialConnected),
    },
    payments: {
      all: {
        ...allPayments,
        paidConnectRate: ratio(allPayments.paidConnected, allPayments.paymentSucceeded),
        trialToPaidRateFromCreatedTrial: ratio(allPayments.trialToPaidSucceeded, trialCreated),
        trialToPaidRateFromConnectedTrial: ratio(allPayments.trialToPaidSucceeded, trialConnected),
      },
      test: paymentBucket(filteredOrders, connectedOrderIds, true),
      live: paymentBucket(filteredOrders, connectedOrderIds, false),
    },
  };
}

function adminAllowed(request, config) {
  const actual = request.headers["x-admin-token"];
  const expected = config.adminToken;
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function createFunnelAnalyticsHandler({ store, config, now = () => new Date() }) {
  return async function funnelAnalyticsHandler(request, response) {
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
    if (typeof store?.listFunnelOrders !== "function" || typeof store?.listTrialConversions !== "function") {
      return send(response, 503, { error: "analytics_store_unavailable" });
    }

    try {
      const url = new URL(request.url, "http://localhost");
      const semester = url.searchParams.get("semester") || config.offerSemester;
      const academicYear = url.searchParams.get("academicYear") || config.offerAcademicYear;
      const university = url.searchParams.get("university") || "";
      const [orders, conversions, accesses] = await Promise.all([
        store.listFunnelOrders(),
        store.listTrialConversions(),
        store.listSubscriptionAccess(),
      ]);
      return send(response, 200, buildFunnelSummary({
        orders,
        conversions,
        accesses,
        filter: { university, academicYear, semester },
        now: now(),
      }));
    } catch (error) {
      console.error(error);
      return send(response, 503, { error: "analytics_unavailable" });
    }
  };
}
