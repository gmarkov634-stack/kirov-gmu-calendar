import { buildCalendar } from "./calendar.js";

const DISCLAIMER = "Календарь составлен по официальному расписанию. Переносы и изменения, согласованные группой с преподавателем, в календаре не отображаются.";

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

function validateSubscription(subscription) {
  const expiresAt = Date.parse(subscription?.expiresAt);
  if (!subscription || subscription.version !== 1 || !/^\d{3}$/.test(String(subscription.group)) || !Number.isFinite(expiresAt)) {
    throw new Error("Invalid subscription record");
  }
  return { ...subscription, expiresAt };
}

function emptySchedule(subscription) {
  return {
    group: String(subscription.group),
    faculty: subscription.faculty,
    course: subscription.course,
    academicYear: subscription.academicYear,
    semester: subscription.semester,
    timezone: "Europe/Moscow",
    events: [],
  };
}

export function createHandler({ store, config, payments }) {
  return async function handler(request, response) {
    const origin = request.headers.origin;
    if (origin && origin === config.allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return send(response, 204, "", "text/plain");
    const url = new URL(request.url, "http://localhost");
    if (request.method === "POST" && url.pathname === "/api/v1/payments") {
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const input = await readJson(request);
        const group = String(input.group || "");
        if (!/^\d{3}$/.test(group) || !validEmail(input.email)) return send(response, 400, { error: "invalid_checkout" });
        const schedule = await store.get(group);
        if (!schedule || schedule.faculty !== input.faculty || schedule.course !== Number(input.course)) {
          return send(response, 400, { error: "offer_not_found" });
        }
        if (Date.now() >= Date.parse(config.offerExpiresAt)) return send(response, 409, { error: "offer_expired" });
        const payment = await payments.create({ group, email: input.email.trim().toLowerCase(), schedule });
        if (!payment.confirmationUrl) throw new Error("YooKassa did not return confirmation URL");
        return send(response, 201, payment, "application/json; charset=utf-8", "no-store");
      } catch (error) {
        console.error(error);
        if (["invalid_json", "request_too_large"].includes(error.message)) return send(response, 400, { error: error.message });
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

    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });

    if (url.pathname === "/health") {
      return send(response, 200, { status: "ok", service: "kgmu-calendar-api" });
    }
    if (url.pathname === "/api/v1/meta") {
      return send(response, 200, {
        service: "Календарь КГМУ",
        timezone: "Europe/Moscow",
        academicYear: "2025-2026",
        semester: 2,
        disclaimer: DISCLAIMER,
      });
    }
    if (url.pathname === "/api/v1/groups") {
      return send(response, 200, { groups: store.listGroups() });
    }

    const orderMatch = url.pathname.match(/^\/api\/v1\/orders\/([A-Za-z0-9_-]{32})$/);
    if (orderMatch) {
      if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });
      try {
        const order = await payments.getOrder(orderMatch[1]);
        if (!order) return send(response, 404, { error: "order_not_found" });
        return send(response, 200, order, "application/json; charset=utf-8", "no-store");
      } catch (error) {
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
        const active = subscription.status === "active" && Date.now() < subscription.expiresAt;
        const schedule = active ? await store.get(String(subscription.group)) : emptySchedule(subscription);
        if (!schedule) throw new Error("Subscription schedule is not published");
        if (active && (
          schedule.faculty !== subscription.faculty ||
          schedule.course !== subscription.course ||
          schedule.academicYear !== subscription.academicYear ||
          schedule.semester !== subscription.semester
        )) throw new Error("Subscription does not match published schedule");

        const calendar = buildCalendar(schedule, config.publicSiteUrl);
        response.setHeader("Content-Disposition", `inline; filename=kgmu-${subscription.group}.ics`);
        response.setHeader("X-Subscription-Status", active ? "active" : subscription.status === "active" ? "expired" : "revoked");
        return send(response, 200, calendar, "text/calendar; charset=utf-8", "private, no-store");
      } catch (error) {
        console.error(error);
        return send(response, 503, { error: "subscription_unavailable" });
      }
    }

    const match = url.pathname.match(/^\/api\/v1\/groups\/(\d{3})\/(schedule|calendar\.ics)$/);
    if (!match) return send(response, 404, { error: "not_found" });
    if (!config.enablePublicEndpoints) return send(response, 404, { error: "not_found" });

    try {
      const schedule = await store.get(match[1]);
      if (!schedule) return send(response, 404, { error: "schedule_not_published", group: match[1] });
      if (match[2] === "calendar.ics") {
        const calendar = buildCalendar(schedule, config.publicSiteUrl);
        response.setHeader("Content-Disposition", `inline; filename=kgmu-${match[1]}.ics`);
        return send(response, 200, calendar, "text/calendar; charset=utf-8");
      }
      return send(response, 200, { ...schedule, disclaimer: DISCLAIMER });
    } catch (error) {
      console.error(error);
      return send(response, 503, { error: "schedule_storage_unavailable" });
    }
  };
}
