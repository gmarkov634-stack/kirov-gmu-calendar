import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeAcademicYear } from "./order-context.js";

const SHA256 = /^[a-f0-9]{64}$/;
const DASHBOARD_WINDOWS = new Set([1, 7, 30]);

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

function validJourneyHash(value) {
  return SHA256.test(String(value || ""));
}

function eventJourneySet(events, eventName) {
  return new Set(events
    .filter((value) => value?.kind === "event" && value.event === eventName && validJourneyHash(value.journeyIdHash))
    .map((value) => value.journeyIdHash));
}

function linkedJourneySet(values, linkMap, idField) {
  const result = new Set();
  for (const value of values) {
    const id = value?.[idField];
    const journey = linkMap.get(id);
    if (journey) result.add(journey);
  }
  return result;
}

function parsedTime(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function inWindow(value, cutoff, fields) {
  if (cutoff === null) return true;
  for (const field of fields) {
    const timestamp = parsedTime(value?.[field]);
    if (timestamp !== null) return timestamp >= cutoff;
  }
  return false;
}

function moneyValue(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function moneyTotal(orders) {
  return Number(orders.reduce((sum, order) => sum + moneyValue(order?.amount), 0).toFixed(2));
}

function moneyAverage(orders) {
  return orders.length ? Number((moneyTotal(orders) / orders.length).toFixed(2)) : 0;
}

function safeSegment(value, fallback = "unknown") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  const normalized = text.replace(/[^a-z0-9а-яё._-]+/giu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || fallback;
}

function attributionSource(event) {
  const source = safeSegment(event?.attribution?.source, "");
  if (source) return source;
  const referral = String(event?.attribution?.referral || "").toLowerCase();
  if (referral.includes("vk.ru") || referral.includes("vk.com") || referral === "vk") return "vk";
  return "direct";
}

function uniqueEventCountBy(events, eventName, field) {
  const byValue = new Map();
  for (const event of events) {
    if (event?.kind !== "event" || event.event !== eventName || !validJourneyHash(event.journeyIdHash)) continue;
    const value = safeSegment(event?.[field], "other");
    if (!byValue.has(value)) byValue.set(value, new Set());
    byValue.get(value).add(event.journeyIdHash);
  }
  return Object.fromEntries([...byValue.entries()].map(([key, journeys]) => [key, journeys.size]));
}

function commercialBucket(orders, connectedOrderIds) {
  const succeeded = orders.filter((order) => order?.status === "succeeded");
  const connected = succeeded.filter((order) => connectedOrderIds.has(order.orderId));
  return {
    orders: succeeded.length,
    revenueRub: moneyTotal(succeeded),
    averageOrderRub: moneyAverage(succeeded),
    connected: connected.length,
    connectRate: ratio(connected.length, succeeded.length),
  };
}

function orderBreakdown(orders, keyFn) {
  const buckets = new Map();
  for (const order of orders.filter((value) => value?.status === "succeeded")) {
    const key = keyFn(order);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(order);
  }
  return Object.fromEntries([...buckets.entries()].map(([key, values]) => [key, {
    orders: values.length,
    revenueRub: moneyTotal(values),
  }]));
}

function sourceBreakdown(events, liveOrders, orderLinkMap) {
  const journeySource = new Map();
  const sourceJourneys = new Map();
  const orderedEvents = [...events].sort((a, b) => (parsedTime(a?.createdAt) || 0) - (parsedTime(b?.createdAt) || 0));

  for (const event of orderedEvents) {
    if (event?.kind !== "event" || !validJourneyHash(event.journeyIdHash)) continue;
    const source = attributionSource(event);
    if (!journeySource.has(event.journeyIdHash) || source !== "direct") journeySource.set(event.journeyIdHash, source);
    if (event.event === "landing_view") {
      if (!sourceJourneys.has(source)) sourceJourneys.set(source, new Set());
      sourceJourneys.get(source).add(event.journeyIdHash);
    }
  }

  const sales = new Map();
  for (const order of liveOrders.filter((value) => value?.status === "succeeded")) {
    const journey = orderLinkMap.get(order.orderId);
    const source = journey ? (journeySource.get(journey) || "direct") : "unknown";
    if (!sales.has(source)) sales.set(source, []);
    sales.get(source).push(order);
  }

  const keys = new Set([...sourceJourneys.keys(), ...sales.keys()]);
  return [...keys].map((source) => {
    const orders = sales.get(source) || [];
    return {
      source,
      visits: sourceJourneys.get(source)?.size || 0,
      orders: orders.length,
      revenueRub: moneyTotal(orders),
    };
  }).sort((a, b) => b.orders - a.orders || b.visits - a.visits || a.source.localeCompare(b.source)).slice(0, 20);
}

function demandBreakdown(events, liveOrders, connectedOrderIds) {
  const selected = new Map();
  for (const event of events) {
    if (event?.kind !== "event" || event.event !== "group_selected" || !validJourneyHash(event.journeyIdHash)) continue;
    if (!event.groupCode) continue;
    const key = `${event.program || ""}|${event.course || ""}|${event.groupCode}`;
    if (!selected.has(key)) selected.set(key, { journeys: new Set(), program: event.program || null, course: event.course || null, groupCode: event.groupCode });
    selected.get(key).journeys.add(event.journeyIdHash);
  }

  const sales = new Map();
  for (const order of liveOrders.filter((value) => value?.status === "succeeded" && value?.groupCode)) {
    const key = `${order.program || ""}|${order.course || ""}|${order.groupCode}`;
    if (!sales.has(key)) sales.set(key, []);
    sales.get(key).push(order);
  }

  const keys = new Set([...selected.keys(), ...sales.keys()]);
  const groups = [...keys].map((key) => {
    const selectedRow = selected.get(key);
    const orders = sales.get(key) || [];
    const sample = orders[0] || selectedRow || {};
    return {
      program: sample.program || null,
      course: Number(sample.course) || null,
      groupCode: sample.groupCode || "—",
      selected: selectedRow?.journeys.size || 0,
      orders: orders.length,
      revenueRub: moneyTotal(orders),
      connected: orders.filter((order) => connectedOrderIds.has(order.orderId)).length,
    };
  }).sort((a, b) => b.orders - a.orders || b.selected - a.selected || a.groupCode.localeCompare(b.groupCode)).slice(0, 20);

  const programs = new Map();
  const courses = new Map();
  for (const group of groups) {
    const programKey = group.program || "unknown";
    if (!programs.has(programKey)) programs.set(programKey, { program: group.program, selected: 0, orders: 0, revenueRub: 0 });
    const program = programs.get(programKey);
    program.selected += group.selected;
    program.orders += group.orders;
    program.revenueRub = Number((program.revenueRub + group.revenueRub).toFixed(2));

    const courseKey = `${programKey}|${group.course || ""}`;
    if (!courses.has(courseKey)) courses.set(courseKey, { program: group.program, course: group.course, selected: 0, orders: 0, revenueRub: 0 });
    const course = courses.get(courseKey);
    course.selected += group.selected;
    course.orders += group.orders;
    course.revenueRub = Number((course.revenueRub + group.revenueRub).toFixed(2));
  }

  return {
    groups,
    programs: [...programs.values()].sort((a, b) => b.orders - a.orders || b.selected - a.selected),
    courses: [...courses.values()].sort((a, b) => b.orders - a.orders || b.selected - a.selected),
  };
}

export function buildFunnelSummary({
  orders = [],
  conversions = [],
  accesses = [],
  events = [],
  filter = {},
  now = new Date(),
  windowDays = null,
  collectionEnabled = null,
} = {}) {
  const currentTime = now instanceof Date ? now : new Date(now);
  const normalizedWindowDays = DASHBOARD_WINDOWS.has(Number(windowDays)) ? Number(windowDays) : null;
  const cutoff = normalizedWindowDays ? currentTime.getTime() - normalizedWindowDays * 24 * 60 * 60 * 1000 : null;
  const periodFilter = {
    university: filter.university || null,
    academicYear: normalizeAcademicYear(filter.academicYear) || null,
    semester: Number(filter.semester) || null,
  };

  const filteredOrders = orders
    .filter((value) => samePeriod(value, periodFilter))
    .filter((value) => inWindow(value, cutoff, value?.status === "succeeded" ? ["updatedAt", "createdAt"] : ["createdAt", "updatedAt"]));
  const filteredConversions = conversions
    .filter((value) => samePeriod(value, periodFilter))
    .filter((value) => inWindow(value, cutoff, ["createdAt", "updatedAt"]));
  const filteredEvents = events
    .filter((value) => samePeriod(value, periodFilter))
    .filter((value) => inWindow(value, cutoff, ["createdAt"]));
  const windowedAccesses = accesses.filter((value) => inWindow(value, cutoff, ["firstSeenAt"]));
  const userEvents = filteredEvents.filter((value) => value?.kind === "event" && validJourneyHash(value.journeyIdHash));
  const accessByHash = new Map(
    windowedAccesses
      .filter((value) => SHA256.test(String(value?.tokenHash || "")))
      .map((value) => [value.tokenHash, value]),
  );
  const connectedOrderIds = new Set(
    windowedAccesses
      .filter((value) => value?.orderId && value?.firstSeenAt)
      .map((value) => value.orderId),
  );
  const trialLinkMap = new Map(filteredEvents
    .filter((value) => value?.kind === "link" && value.linkType === "trial" && SHA256.test(String(value.conversionIdHash || "")) && validJourneyHash(value.journeyIdHash))
    .map((value) => [value.conversionIdHash, value.journeyIdHash]));
  const orderLinkMap = new Map(filteredEvents
    .filter((value) => value?.kind === "link" && value.linkType === "order" && value.orderId && validJourneyHash(value.journeyIdHash))
    .map((value) => [value.orderId, value.journeyIdHash]));

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

  const landingJourneys = eventJourneySet(userEvents, "landing_view");
  const universityJourneys = eventJourneySet(userEvents, "university_view");
  const groupJourneys = eventJourneySet(userEvents, "group_selected");
  const trialCtaJourneys = eventJourneySet(userEvents, "trial_cta_clicked");
  const directCtaJourneys = eventJourneySet(userEvents, "direct_purchase_clicked");
  const trialConnectClickJourneys = eventJourneySet(userEvents, "trial_connect_clicked");
  const offerJourneys = eventJourneySet(userEvents, "offer_view");
  const checkoutJourneys = eventJourneySet(userEvents, "checkout_started");
  const paidLinkShownJourneys = eventJourneySet(userEvents, "paid_link_shown");
  const paidConnectClickJourneys = eventJourneySet(userEvents, "paid_connect_clicked");

  const linkedTrialCreatedJourneys = linkedJourneySet(filteredConversions, trialLinkMap, "conversionIdHash");
  const linkedTrialConnectedJourneys = linkedJourneySet(connectedTrialConversions, trialLinkMap, "conversionIdHash");
  const succeededOrders = filteredOrders.filter((order) => order?.status === "succeeded");
  const liveSucceededOrders = succeededOrders.filter((order) => order.testMode !== true);
  const testSucceededOrders = succeededOrders.filter((order) => order.testMode === true);
  const trialToPaidOrders = succeededOrders.filter((order) => order.purchasePath === "trial_to_paid");
  const connectedOrders = succeededOrders.filter((order) => connectedOrderIds.has(order.orderId));
  const linkedSucceededJourneys = linkedJourneySet(succeededOrders, orderLinkMap, "orderId");
  const linkedTrialToPaidJourneys = linkedJourneySet(trialToPaidOrders, orderLinkMap, "orderId");
  const linkedPaidConnectedJourneys = linkedJourneySet(connectedOrders, orderLinkMap, "orderId");
  const demand = demandBreakdown(userEvents, liveSucceededOrders, connectedOrderIds);

  return {
    version: 2,
    generatedAt: currentTime.toISOString(),
    filter: periodFilter,
    window: {
      days: normalizedWindowDays,
      from: cutoff === null ? null : new Date(cutoff).toISOString(),
      to: currentTime.toISOString(),
    },
    collection: {
      enabled: collectionEnabled === true,
      mode: collectionEnabled === true ? "open" : "closed",
    },
    upper: {
      uniqueJourneys: {
        landingView: landingJourneys.size,
        universityView: universityJourneys.size,
        groupSelected: groupJourneys.size,
        trialCtaClicked: trialCtaJourneys.size,
        directPurchaseClicked: directCtaJourneys.size,
        trialConnectClicked: trialConnectClickJourneys.size,
        offerView: offerJourneys.size,
        checkoutStarted: checkoutJourneys.size,
        paidLinkShown: paidLinkShownJourneys.size,
        paidConnectClicked: paidConnectClickJourneys.size,
      },
      linkedServerFacts: {
        trialCreated: linkedTrialCreatedJourneys.size,
        trialConnected: linkedTrialConnectedJourneys.size,
        paymentSucceeded: linkedSucceededJourneys.size,
        trialToPaidSucceeded: linkedTrialToPaidJourneys.size,
        paidConnected: linkedPaidConnectedJourneys.size,
      },
      linkCoverage: {
        trialCreated: ratio(linkedTrialCreatedJourneys.size, trialCreated),
        paymentSucceeded: ratio(linkedSucceededJourneys.size, allPayments.paymentSucceeded),
      },
      rates: {
        landingToGroupSelected: ratio(groupJourneys.size, landingJourneys.size),
        groupSelectedToTrialCreated: ratio(linkedTrialCreatedJourneys.size, groupJourneys.size),
        trialCreatedToConnected: ratio(linkedTrialConnectedJourneys.size, linkedTrialCreatedJourneys.size),
        connectedTrialToPaid: ratio(linkedTrialToPaidJourneys.size, linkedTrialConnectedJourneys.size),
        checkoutToPayment: ratio(linkedSucceededJourneys.size, checkoutJourneys.size),
        paymentToPaidConnected: ratio(linkedPaidConnectedJourneys.size, linkedSucceededJourneys.size),
        landingToPaidConnected: ratio(linkedPaidConnectedJourneys.size, landingJourneys.size),
      },
    },
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
    commercial: {
      live: commercialBucket(liveSucceededOrders, connectedOrderIds),
      test: commercialBucket(testSucceededOrders, connectedOrderIds),
      plans: orderBreakdown(liveSucceededOrders, (order) => order.plan === "year" ? "year" : "semester"),
      purchasePaths: orderBreakdown(liveSucceededOrders, (order) => order.purchasePath === "trial_to_paid" ? "trial_to_paid" : "direct_purchase"),
    },
    segments: {
      sources: sourceBreakdown(userEvents, liveSucceededOrders, orderLinkMap),
      channels: {
        trial: uniqueEventCountBy(userEvents, "trial_connect_clicked", "channel"),
        paid: uniqueEventCountBy(userEvents, "paid_connect_clicked", "channel"),
      },
      groups: demand.groups,
      programs: demand.programs,
      courses: demand.courses,
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
      const daysValue = url.searchParams.get("days");
      let windowDays = null;
      if (daysValue && daysValue !== "all") {
        windowDays = Number(daysValue);
        if (!DASHBOARD_WINDOWS.has(windowDays)) return send(response, 400, { error: "invalid_analytics_window" });
      }
      const [orders, conversions, accesses, events] = await Promise.all([
        store.listFunnelOrders(),
        store.listTrialConversions(),
        store.listSubscriptionAccess(),
        typeof store.listFunnelEvents === "function" ? store.listFunnelEvents() : Promise.resolve([]),
      ]);
      return send(response, 200, buildFunnelSummary({
        orders,
        conversions,
        accesses,
        events,
        filter: { university, academicYear, semester },
        windowDays,
        collectionEnabled: config.funnelAnalyticsEnabled === true,
        now: now(),
      }));
    } catch (error) {
      console.error(error);
      return send(response, 503, { error: "analytics_unavailable" });
    }
  };
}
