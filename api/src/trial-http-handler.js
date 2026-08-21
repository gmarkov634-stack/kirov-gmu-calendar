import { accessObservation } from "./access-monitor.js";
import { buildCalendar } from "./calendar.js";
import { scheduleContext } from "./order-context.js";
import { trialIdentityFingerprint } from "./trial-identity.js";
import { projectTrialSchedule } from "./trial-projection.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function send(response, status, body, type = "application/json; charset=utf-8") {
  const content = type.startsWith("application/json") ? JSON.stringify(body) : body;
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
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

function allowCors(request, response, config) {
  const origin = request.headers.origin;
  const allowedOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : [config.allowedOrigin].filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizedHttpsBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function continueUrl(config, subscription) {
  const base = normalizedHttpsBaseUrl(config.universitySiteUrls?.[subscription.university]);
  if (!base || !TOKEN.test(String(subscription.conversionId || ""))) return "";
  const url = new URL(`${base}/`);
  url.searchParams.set("continue", subscription.conversionId);
  return url.toString();
}

function sameSchedule(schedule, subscription) {
  const actual = scheduleContext(schedule);
  return actual.university === subscription.university &&
    actual.program === subscription.program &&
    actual.course === subscription.course &&
    actual.stream === subscription.stream &&
    actual.groupId === subscription.groupId &&
    actual.academicYear === subscription.academicYear &&
    actual.semester === subscription.semester;
}

function validTrialSubscription(value) {
  const context = scheduleContext(value, value?.university);
  return value?.version === 2 &&
    value?.entitlement === "trial" &&
    ["active", "upgraded", "revoked"].includes(value?.status) &&
    TOKEN.test(String(value?.conversionId || "")) &&
    /^20\d{2}-\d{2}-\d{2}$/.test(String(value?.trialStartDate || "")) &&
    /^20\d{2}-\d{2}-\d{2}$/.test(String(value?.trialEndDateExclusive || "")) &&
    Boolean(context.university && context.program && context.groupId && context.groupCode && Number.isInteger(context.course));
}

function emptyTrialSchedule(subscription) {
  return {
    university: subscription.university,
    universityName: subscription.universityName,
    program: subscription.program,
    course: subscription.course,
    stream: subscription.stream,
    groupCode: subscription.groupCode,
    groupId: subscription.groupId,
    groupDisplayName: subscription.groupDisplayName,
    timezone: subscription.timezone,
    academicYear: subscription.academicYear,
    semester: subscription.semester,
    events: [],
  };
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

function publicSite(config, university) {
  return String(config.universitySiteUrls?.[university] || "").trim();
}

export function createTrialHttpHandler({ store, config, trials }) {
  async function handleApi(request, response) {
    const url = new URL(request.url, "http://localhost");
    const continueMatch = url.pathname.match(/^\/api\/v2\/trials\/continue\/([A-Za-z0-9_-]{43})$/);
    const isCreate = url.pathname === "/api/v2/trials";
    if (!isCreate && !continueMatch) return false;

    allowCors(request, response, config);
    if (request.method === "OPTIONS") {
      send(response, 204, "", "text/plain; charset=utf-8");
      return true;
    }

    if (isCreate && request.method === "POST") {
      try {
        const input = await readJson(request);
        const result = await trials.create(input, {
          identityHash: trialIdentityFingerprint(request, config.trialIdentityHmacSecret),
        });
        send(response, 201, result);
      } catch (error) {
        if (["invalid_json", "request_too_large"].includes(error.message)) send(response, 400, { error: error.message });
        else if (error.code === "invalid_trial_context") send(response, 400, { error: error.code });
        else if (["trials_not_open", "university_trials_not_open", "trial_window_closed", "trial_already_claimed"].includes(error.code)) send(response, 409, { error: error.code });
        else if (["offer_not_found", "trial_not_ready"].includes(error.code)) send(response, 409, { error: error.code });
        else {
          console.error(error);
          send(response, 503, { error: "trial_unavailable" });
        }
      }
      return true;
    }

    if (continueMatch && request.method === "GET") {
      try {
        const context = await trials.continue(continueMatch[1]);
        if (!context) send(response, 404, { error: "trial_context_not_found" });
        else send(response, 200, context);
      } catch (error) {
        console.error(error);
        send(response, 503, { error: "trial_context_unavailable" });
      }
      return true;
    }

    send(response, 405, { error: "method_not_allowed" });
    return true;
  }

  async function handleSubscription(request, response) {
    if (request.method !== "GET") return false;
    const url = new URL(request.url, "http://localhost");
    const match = url.pathname.match(/^\/api\/v1\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/);
    if (!match) return false;

    let raw;
    try {
      raw = await store.getSubscription(match[1]);
    } catch (error) {
      console.error(error);
      return false;
    }
    if (!raw || raw.entitlement !== "trial") return false;

    allowCors(request, response, config);
    try {
      if (!validTrialSubscription(raw)) throw new Error("Invalid trial subscription record");
      const subscription = { ...raw, ...scheduleContext(raw, raw.university) };

      if (subscription.status === "active" && config.subscriptionSigningSecret?.length >= 32) {
        try {
          await store.recordSubscriptionAccess(
            match[1],
            subscription,
            accessObservation(request, config.subscriptionSigningSecret),
          );
        } catch (error) {
          console.error("trial subscription access monitoring failed", error);
        }
      }

      let projected = emptyTrialSchedule(subscription);
      if (subscription.status === "active") {
        const schedule = await store.getSchedule(subscription);
        if (!schedule) throw new Error("Trial schedule is not published");
        if (!sameSchedule(schedule, subscription)) throw new Error("Trial does not match published schedule");
        projected = projectTrialSchedule(schedule, subscription, {
          continueUrl: continueUrl(config, subscription),
        });
      }

      const calendar = buildCalendar(projected, publicSite(config, subscription.university));
      response.setHeader("Content-Disposition", `inline; filename=${safeFilename(`${subscription.university}-${subscription.groupCode}-trial`)}.ics`);
      response.setHeader("X-Subscription-Status", subscription.status === "active" ? "active" : subscription.status);
      response.setHeader("X-Subscription-Entitlement", "trial");
      response.setHeader("X-Trial-Start-Date", subscription.trialStartDate);
      response.setHeader("X-Trial-End-Date-Exclusive", subscription.trialEndDateExclusive);
      send(response, 200, calendar, "text/calendar; charset=utf-8");
    } catch (error) {
      console.error(error);
      send(response, 503, { error: "trial_subscription_unavailable" });
    }
    return true;
  }

  return { handleApi, handleSubscription };
}
