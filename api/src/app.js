import { createHash, timingSafeEqual } from "node:crypto";
import { accessObservation } from "./access-monitor.js";
import { buildCalendar } from "./calendar.js";
import { scheduleContext } from "./order-context.js";
import { effectiveSubscriptionEnd } from "./subscription-period.js";

const DISCLAIMER = "Календарь составлен по официальному расписанию. Переносы и изменения, согласованные группой с преподавателем, в календаре не отображаются.";
const UNIVERSITY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PLAN_IDS = new Set(["semester", "year"]);

function send(response, status, body, type = "application/json; charset=utf-8", cacheControl) {
  const content = type.startsWith("application/json") ? JSON.stringify(body) : body;
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": cacheControl || (status === 200 ? "public, max-age=300" : "no-store"),
  });
  response.end(content);
}

async function readJson(request, limit = 16384) {
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

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function orderAccessToken(request) {
  const value = request.headers["x-order-token"];
  return typeof value === "string" ? value : "";
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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validateContext(value) {
  const university = nonEmptyString(value?.university);
  const universityId = nonEmptyString(value?.university_id);
  if (university && universityId && university !== universityId) return null;
  const context = scheduleContext(value, university || universityId);
  if (
    !UNIVERSITY_ID.test(context.university || "") ||
    !context.program ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !context.groupCode ||
    !context.groupId
  ) return null;
  return context;
}

function universityCapability(config, university, capability) {
  const policy = config?.universityAccess?.[university];
  if (!policy || typeof policy !== "object") return true;
  return policy[capability] !== false;
}

function validateSubscription(value) {
  const context = validateContext(value);
  const expiresAt = Date.parse(value?.expiresAt);
  const plan = value?.plan || "semester";
  if (!value || value.version !== 2 || !context || !Number.isFinite(expiresAt) || !PLAN_IDS.has(plan)) {
    throw new Error("Invalid subscription record");
  }
  return { ...value, ...context, plan, expiresAt };
}

function emptySchedule(subscription) {
  return {
    version: 1,
    ...scheduleContext(subscription),
    group: {
      id: subscription.groupId,
      code: subscription.groupCode,
      displayName: subscription.groupDisplayName,
    },
    sources: [],
    events: [],
  };
}

function sameSchedule(schedule, subscription) {
  const actual = scheduleContext(schedule);
  const sameContext = actual.university === subscription.university &&
    actual.program === subscription.program &&
    actual.course === subscription.course &&
    actual.stream === subscription.stream &&
    actual.groupId === subscription.groupId &&
    actual.academicYear === subscription.academicYear;
  if (!sameContext) return false;
  return subscription.plan === "year" || actual.semester === subscription.semester;
}

function safeFilename(value) {
  const result = String(value || "calendar")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return result || "calendar";
}

function siteUrl(config, university) {
  return String(config.universitySiteUrls?.[university] || "").trim();
}

function salesState(config) {
  return config?.commercialSalesEnabled === true ? "open" : "closed";
}

function trialState(config) {
  return config?.trialsEnabled === true ? "open" : "closed";
}

function paymentMode(config) {
  return config?.yookassaTestMode === true ? "test" : "live";
}

function publicOfferPrices(config) {
  const result = {};
  for (const plan of PLAN_IDS) {
    const price = String(config?.offers?.[plan]?.price || "");
    if (/^\d+\.\d{2}$/.test(price) && Number(price) > 0) result[plan] = { price };
  }
  return result;
}

export function createHandler({ store, config, payments }) {
  return async function handler(request, response) {
    const origin = request.headers.origin;
    const allowedOrigins = Array.isArray(config.allowedOrigins)
      ? config.allowedOrigins
      : [config.allowedOrigin].filter(Boolean);
    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Order-Token, X-Admin-Token");
    if (request.method === "OPTIONS") return send(response, 204, "", "text/plain");

    const url = new URL(request.url, "http://localhost");

    if (request.method === "POST" && url.pathname === "/api/v2/payments") {
      if (salesState(config) !== "open") {
        return send(response, 409, { error: "sales_not_open" }, "application/json; charset=utf-8", "no-store");
      }
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const input = await readJson(request);
        const plan = input.plan || "semester";
        if (!validEmail(input.email) || !PLAN_IDS.has(plan)) return send(response, 400, { error: "invalid_checkout" });
        const context = validateContext(input);
        if (!context || !universityCapability(config, context.university, "apiRoutingEnabled")) {
          return send(response, 400, { error: "invalid_checkout" });
        }
        if (!universityCapability(config, context.university, "checkoutEnabled")) {
          return send(response, 409, { error: "university_sales_not_open" }, "application/json; charset=utf-8", "no-store");
        }
        const schedule = await store.getSchedule(context);
        if (!schedule || !sameSchedule(schedule, { ...context, academicYear: scheduleContext(schedule).academicYear, semester: scheduleContext(schedule).semester })) {
          return send(response, 400, { error: "offer_not_found" });
        }
        const payment = await payments.create({
          email: input.email.trim().toLowerCase(),
          schedule,
          plan,
          conversionId: typeof input.conversionId === "string" ? input.conversionId : "",
        });
        if (!payment.confirmationUrl) throw new Error("YooKassa did not return confirmation URL");
        return send(response, 201, payment, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        console.error(error);
        if (["invalid_json", "request_too_large"].includes(error.message)) return send(response, 400, { error: error.message });
        if (error.code === "invalid_plan") return send(response, 400, { error: "invalid_checkout" });
        if (error.code === "trial_context_invalid") return send(response, 400, { error: error.code });
        if (error.code === "semester_end_not_found") return send(response, 409, { error: "offer_not_ready" });
        if (error.code === "offer_expired") return send(response, 409, { error: "offer_expired" });
        return send(response, 503, { error: "payment_unavailable" });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/yookassa/webhook") {
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const notification = await readJson(request);
        if (notification.event === "payment.succeeded" && notification.object?.id) {
          await payments.fulfillByPaymentId(notification.object.id);
        }
        return send(response, 200, { status: "ok" }, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        console.error(error);
        return send(response, 503, { error: "webhook_retry" });
      }
    }

    const adminAction = url.pathname.match(/^\/api\/v1\/admin\/subscriptions\/([a-f0-9]{64})\/(revoke|rotate)$/);
    if (request.method === "POST" && adminAction) {
      if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
      if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
      try {
        if (adminAction[2] === "revoke") {
          const subscription = await store.revokeSubscriptionByHash(adminAction[1]);
          if (!subscription) return send(response, 404, { error: "subscription_not_found" });
          return send(response, 200, { status: "revoked", groupCode: subscription.groupCode }, "application/json; charset=utf-8", "no-store");
        }
        if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
        const record = (await store.listSubscriptionAccess()).find((item) => item.tokenHash === adminAction[1]);
        if (!record?.orderId) return send(response, 409, { error: "order_not_available" });
        const order = await payments.rotateSubscriptionAsAdmin(record.orderId, adminAction[1]);
        if (!order) return send(response, 404, { error: "order_not_found" });
        return send(response, 200, order, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        if (error.code === "subscription_not_current") return send(response, 409, { error: error.code });
        console.error(error);
        return send(response, 503, { error: "admin_action_unavailable" });
      }
    }

    const rotateMatch = url.pathname.match(/^\/api\/v1\/orders\/([A-Za-z0-9_-]{32})\/subscription\/reset$/);
    if (request.method === "POST" && rotateMatch) {
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const order = await payments.rotateSubscription(rotateMatch[1], orderAccessToken(request));
        if (!order) return send(response, 404, { error: "order_not_found" });
        return send(response, 200, order, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        if (error.code === "order_forbidden") return send(response, 403, { error: error.code });
        if (error.code === "order_not_succeeded") return send(response, 409, { error: error.code });
        console.error(error);
        return send(response, 503, { error: "subscription_reset_unavailable" });
      }
    }

    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });

    if (url.pathname === "/health") return send(response, 200, { status: "ok", service: "medical-calendar-api" });
    if (url.pathname === "/api/v2/meta") {
      return send(response, 200, {
        service: "Календари медицинских вузов",
        version: 2,
        disclaimer: DISCLAIMER,
        sales: salesState(config),
        trials: trialState(config),
        paymentMode: paymentMode(config),
        offers: publicOfferPrices(config),
      }, "application/json; charset=utf-8", "no-store");
    }

    if (url.pathname === "/api/v1/admin/subscriptions") {
      if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
      if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
      try {
        const records = await store.listSubscriptionAccess();
        return send(response, 200, { subscriptions: records.map(({ sources, ...record }) => record) }, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        console.error(error);
        return send(response, 503, { error: "admin_list_unavailable" });
      }
    }

    const orderMatch = url.pathname.match(/^\/api\/v1\/orders\/([A-Za-z0-9_-]{32})$/);
    if (orderMatch) {
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const order = await payments.getOrder(orderMatch[1], { accessToken: orderAccessToken(request) });
        if (!order) return send(response, 404, { error: "order_not_found" });
        return send(response, 200, order, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        if (error.code === "order_forbidden") return send(response, 403, { error: error.code });
        console.error(error);
        return send(response, 503, { error: "order_unavailable" });
      }
    }

    const subscriptionMatch = url.pathname.match(/^\/api\/v1\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/);
    if (subscriptionMatch) {
      try {
        const rawSubscription = await store.getSubscription(subscriptionMatch[1]);
        if (!rawSubscription) return send(response, 404, { error: "subscription_not_found" });
        const subscription = validateSubscription(rawSubscription);
        if (subscription.status === "active" && config.subscriptionSigningSecret?.length >= 32) {
          try {
            await store.recordSubscriptionAccess(
              subscriptionMatch[1],
              subscription,
              accessObservation(request, config.subscriptionSigningSecret),
            );
          } catch (error) {
            console.error("subscription access monitoring failed", error);
          }
        }

        let publishedSchedule = null;
        let effectiveExpiresAt = new Date(subscription.expiresAt).toISOString();
        if (subscription.status === "active") {
          publishedSchedule = await store.getSchedule(subscription);
          if (!publishedSchedule) throw new Error("Subscription schedule is not published");
          if (!sameSchedule(publishedSchedule, subscription)) throw new Error("Subscription does not match published schedule");
          effectiveExpiresAt = effectiveSubscriptionEnd(subscription, publishedSchedule);
        }
        const active = subscription.status === "active" && Date.now() < Date.parse(effectiveExpiresAt);
        const schedule = active ? publishedSchedule : emptySchedule(subscription);

        const calendar = buildCalendar(schedule, siteUrl(config, subscription.university));
        response.setHeader("Content-Disposition", `inline; filename=${safeFilename(`${subscription.university}-${subscription.groupCode}`)}.ics`);
        response.setHeader("X-Subscription-Status", active ? "active" : subscription.status === "active" ? "expired" : "revoked");
        response.setHeader("X-Subscription-Expires-At", effectiveExpiresAt);
        return send(response, 200, calendar, "text/calendar; charset=utf-8", "private, no-store");
      } catch (error) {
        console.error(error);
        return send(response, 503, { error: "subscription_unavailable" });
      }
    }

    const publicMatch = url.pathname.match(/^\/api\/v2\/schedules\/([^/]+)\/([^/]+)\/(\d+)\/([^/]+)\/(schedule|calendar\.ics)$/);
    if (!publicMatch || !config.enablePublicEndpoints) return send(response, 404, { error: "not_found" });
    try {
      const context = validateContext({
        university: decodeURIComponent(publicMatch[1]),
        program: decodeURIComponent(publicMatch[2]),
        course: Number(publicMatch[3]),
        groupId: decodeURIComponent(publicMatch[4]),
        groupCode: url.searchParams.get("groupCode") || decodeURIComponent(publicMatch[4]),
        stream: url.searchParams.get("stream"),
      });
      if (!context || !universityCapability(config, context.university, "apiRoutingEnabled")) {
        return send(response, 400, { error: "invalid_schedule_context" });
      }
      if (!universityCapability(config, context.university, "publicEndpointsEnabled")) {
        return send(response, 404, { error: "schedule_not_published" }, "application/json; charset=utf-8", "no-store");
      }
      const schedule = await store.getSchedule(context);
      if (!schedule) return send(response, 404, { error: "schedule_not_published" });
      if (publicMatch[5] === "calendar.ics") {
        response.setHeader("Content-Disposition", `inline; filename=${safeFilename(`${context.university}-${context.groupCode}`)}.ics`);
        return send(response, 200, buildCalendar(schedule, siteUrl(config, context.university)), "text/calendar; charset=utf-8");
      }
      return send(response, 200, { ...schedule, disclaimer: DISCLAIMER });
    } catch (error) {
      console.error(error);
      return send(response, 503, { error: "schedule_storage_unavailable" });
    }
  };
}
