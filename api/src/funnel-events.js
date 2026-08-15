import { createHash } from "node:crypto";
import { normalizeAcademicYear } from "./order-context.js";

const JOURNEY_ID = /^[a-f0-9]{32}$/;
const ORDER_ID = /^[A-Za-z0-9_-]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UNIVERSITY = /^[a-z][a-z0-9-]{1,31}$/;

export const FUNNEL_EVENTS = new Set([
  "landing_view",
  "university_view",
  "group_selected",
  "trial_cta_clicked",
  "direct_purchase_clicked",
  "trial_connect_clicked",
  "offer_view",
  "checkout_started",
  "paid_link_shown",
  "paid_connect_clicked",
]);

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeText(value, max = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function safeAttribution(input = {}) {
  return Object.fromEntries(["source", "medium", "campaign", "content", "referral"].map((key) => [key, safeText(input[key])]));
}

function currentOffer(input, config) {
  const expectedYear = normalizeAcademicYear(config.offerAcademicYear);
  const actualYear = normalizeAcademicYear(input.academicYear);
  const expectedSemester = Number(config.offerSemester);
  const actualSemester = Number(input.semester);
  if (!expectedYear || actualYear !== expectedYear || ![1, 2].includes(expectedSemester) || actualSemester !== expectedSemester) {
    const error = new Error("analytics_period_mismatch");
    error.code = "analytics_period_mismatch";
    throw error;
  }
  return { academicYear: expectedYear, semester: expectedSemester };
}

function baseContext(input, config) {
  const university = safeText(input.university, 32);
  if (!university || !UNIVERSITY.test(university)) {
    const error = new Error("invalid_analytics_event");
    error.code = "invalid_analytics_event";
    throw error;
  }
  return {
    university,
    program: safeText(input.program, 80),
    course: Number.isInteger(Number(input.course)) && Number(input.course) > 0 ? Number(input.course) : null,
    groupCode: safeText(input.groupCode, 80),
    groupId: safeText(input.groupId, 180),
    ...currentOffer(input, config),
  };
}

function recordKey(parts) {
  return hash(parts.map((value) => value ?? "").join("|"));
}

export function trialLinkRecordKey(conversionHash) {
  if (!SHA256.test(String(conversionHash || ""))) return "";
  return recordKey(["trial-link", conversionHash]);
}

export function orderLinkRecordKey(orderId) {
  if (!ORDER_ID.test(String(orderId || ""))) return "";
  return recordKey(["order-link", orderId]);
}

function eventRecordKey(record) {
  return recordKey([
    "event",
    record.journeyIdHash,
    record.event,
    record.university,
    record.program,
    record.course,
    record.groupId,
    record.purchasePath,
    record.plan,
    record.channel,
  ]);
}

function assertJourneyId(value) {
  if (!JOURNEY_ID.test(String(value || ""))) {
    const error = new Error("invalid_analytics_event");
    error.code = "invalid_analytics_event";
    throw error;
  }
  return hash(value);
}

function eventNeedsGroup(event) {
  return !["landing_view", "university_view"].includes(event);
}

function verifiedBridgeContext(value) {
  return {
    university: value.university,
    program: value.program || null,
    course: Number(value.course) || null,
    groupCode: value.groupCode || null,
    groupId: value.groupId || null,
    academicYear: normalizeAcademicYear(value.academicYear),
    semester: Number(value.semester) || null,
  };
}

export async function recordFunnelEvent({ store, config, input = {}, now = () => new Date() }) {
  if (config.funnelAnalyticsEnabled !== true) {
    const error = new Error("analytics_not_open");
    error.code = "analytics_not_open";
    throw error;
  }
  if (typeof store?.putFunnelRecord !== "function") {
    const error = new Error("analytics_store_unavailable");
    error.code = "analytics_store_unavailable";
    throw error;
  }

  const journeyIdHash = assertJourneyId(input.journeyId);
  const createdAt = now().toISOString();

  if (input.event === "trial_linked") {
    if (!TOKEN.test(String(input.conversionId || "")) || typeof store.getTrialConversion !== "function") {
      const error = new Error("invalid_analytics_link");
      error.code = "invalid_analytics_link";
      throw error;
    }
    const conversion = await store.getTrialConversion(input.conversionId);
    if (!conversion || !SHA256.test(String(conversion.conversionIdHash || ""))) {
      const error = new Error("invalid_analytics_link");
      error.code = "invalid_analytics_link";
      throw error;
    }
    const key = trialLinkRecordKey(conversion.conversionIdHash);
    const record = {
      version: 1,
      kind: "link",
      linkType: "trial",
      journeyIdHash,
      conversionIdHash: conversion.conversionIdHash,
      ...verifiedBridgeContext(conversion),
      createdAt,
    };
    await store.putFunnelRecord(key, record);
    return record;
  }

  if (input.event === "order_linked") {
    if (!ORDER_ID.test(String(input.orderId || "")) || typeof store.getOrder !== "function") {
      const error = new Error("invalid_analytics_link");
      error.code = "invalid_analytics_link";
      throw error;
    }
    const order = await store.getOrder(input.orderId);
    if (!order || order.orderId !== input.orderId) {
      const error = new Error("invalid_analytics_link");
      error.code = "invalid_analytics_link";
      throw error;
    }

    let linkedJourneyHash = journeyIdHash;
    if (order.purchasePath === "trial_to_paid" && TOKEN.test(String(input.conversionId || ""))) {
      const conversionHash = hash(input.conversionId);
      if (order.trialConversionHash === conversionHash && typeof store.getFunnelRecord === "function") {
        const trialLink = await store.getFunnelRecord(trialLinkRecordKey(conversionHash));
        if (trialLink?.linkType === "trial" && SHA256.test(String(trialLink.journeyIdHash || ""))) {
          linkedJourneyHash = trialLink.journeyIdHash;
        }
      }
    }

    const key = orderLinkRecordKey(order.orderId);
    const record = {
      version: 1,
      kind: "link",
      linkType: "order",
      journeyIdHash: linkedJourneyHash,
      orderId: order.orderId,
      purchasePath: order.purchasePath || "direct_purchase",
      plan: order.plan || "semester",
      ...verifiedBridgeContext(order),
      createdAt,
    };
    await store.putFunnelRecord(key, record);
    return record;
  }

  if (!FUNNEL_EVENTS.has(input.event)) {
    const error = new Error("invalid_analytics_event");
    error.code = "invalid_analytics_event";
    throw error;
  }
  const context = baseContext(input, config);
  if (eventNeedsGroup(input.event) && (!context.program || !context.course || !context.groupCode || !context.groupId)) {
    const error = new Error("invalid_analytics_event");
    error.code = "invalid_analytics_event";
    throw error;
  }
  const purchasePath = ["direct_purchase", "trial_to_paid"].includes(input.purchasePath) ? input.purchasePath : null;
  const plan = ["semester", "year"].includes(input.plan) ? input.plan : null;
  const channel = ["iphone", "google", "other"].includes(input.channel) ? input.channel : null;
  const record = {
    version: 1,
    kind: "event",
    event: input.event,
    journeyIdHash,
    ...context,
    purchasePath,
    plan,
    channel,
    attribution: safeAttribution(input),
    createdAt,
  };
  await store.putFunnelRecord(eventRecordKey(record), record);
  return record;
}

function allowedOrigin(request, config) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  const values = Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [config.allowedOrigin].filter(Boolean);
  return values.includes(origin);
}

async function readJson(request, limit = 8192) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error("request_too_large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("invalid_json");
  }
}

function send(response, status, body = null) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body === null ? "" : JSON.stringify(body));
}

export function createFunnelEventHandler({ store, config, now = () => new Date() }) {
  return async function funnelEventHandler(request, response) {
    const origin = request.headers?.origin;
    if (origin && allowedOrigin(request, config)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return send(response, allowedOrigin(request, config) ? 204 : 403);
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    if (!allowedOrigin(request, config)) return send(response, 403, { error: "origin_forbidden" });
    if (config.funnelAnalyticsEnabled !== true) return send(response, 409, { error: "analytics_not_open" });

    try {
      const input = await readJson(request);
      await recordFunnelEvent({ store, config, input, now });
      return send(response, 202, { status: "accepted" });
    } catch (error) {
      if (["invalid_json", "request_too_large"].includes(error.message)) return send(response, 400, { error: error.message });
      if (["invalid_analytics_event", "invalid_analytics_link", "analytics_period_mismatch"].includes(error.code)) {
        return send(response, 400, { error: error.code });
      }
      console.error("funnel analytics event failed", error);
      return send(response, 503, { error: "analytics_unavailable" });
    }
  };
}
