import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeAcademicYear, scheduleContext } from "./order-context.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIVERSITY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PROGRAM_ID = /^[a-z][a-z0-9-]{1,31}$/;
const LEGACY_KGMU_PROGRAMS = new Set(["medicine", "pediatrics", "dentistry", "foreign"]);
const LEGACY_KGMU_GROUP_RE = /^\d{3}(?:и)?$/i;

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
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

function adminAllowed(request, config) {
  const actual = request.headers["x-admin-token"];
  const expected = config.adminToken;
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

function publicApiBaseUrl(config) {
  try {
    const url = new URL(String(config.publicApiUrl || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function applyCors(request, response, config) {
  const origin = request.headers.origin;
  const allowedOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : [config.allowedOrigin].filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
}

function normalizedGroupCode(value, university) {
  const groupCode = String(value || "").trim();
  return university === "kgmu" ? groupCode.replace(/i$/i, "и") : groupCode;
}

function requestedContext(input) {
  const university = String(input.university || "kgmu").trim();
  const program = String(input.program || "").trim();
  const course = Number(input.course);
  const groupCode = normalizedGroupCode(input.groupCode || input.group, university);
  const stream = typeof input.stream === "string" && input.stream.trim() ? input.stream.trim() : null;
  const academicYear = normalizeAcademicYear(input.academicYear);
  const semester = Number(input.semester);
  const explicitGroupId = typeof input.groupId === "string" && input.groupId.trim() ? input.groupId.trim() : null;

  if (
    !UNIVERSITY_ID.test(university) ||
    !PROGRAM_ID.test(program) ||
    !Number.isInteger(course) || course < 1 || course > 9 ||
    !groupCode || groupCode.length > 128 ||
    !academicYear ||
    ![1, 2].includes(semester)
  ) return null;

  if (university === "kgmu" && !explicitGroupId) {
    if (!LEGACY_KGMU_PROGRAMS.has(program) || course > 6 || !LEGACY_KGMU_GROUP_RE.test(groupCode)) return null;
    return {
      university,
      program,
      course,
      stream: null,
      groupCode,
      groupId: `kgmu:${program}:${course}:${groupCode}`,
      academicYear,
      semester,
    };
  }

  if (!explicitGroupId || explicitGroupId.length > 256) return null;
  return { university, program, course, stream, groupCode, groupId: explicitGroupId, academicYear, semester };
}

function exactScheduleMatch(actual, requested) {
  return actual.university === requested.university &&
    actual.program === requested.program &&
    actual.course === requested.course &&
    actual.stream === requested.stream &&
    actual.groupCode === requested.groupCode &&
    actual.groupId === requested.groupId &&
    normalizeAcademicYear(actual.academicYear) === requested.academicYear &&
    Number(actual.semester) === requested.semester;
}

export function createPreviewSubscriptionHandler({ store, config }) {
  return async function previewSubscriptionHandler(request, response) {
    applyCors(request, response, config);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Cache-Control": "no-store" });
      return response.end();
    }
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });

    try {
      const input = await readJson(request);
      const requested = requestedContext(input);
      const days = Math.min(30, Math.max(1, Number(input.days || 7)));
      if (!requested) return send(response, 400, { error: "invalid_preview_context" });

      const schedule = await store.getSchedule(requested);
      if (!schedule) return send(response, 404, { error: "schedule_not_published" });

      const context = scheduleContext(schedule, requested.university);
      if (!exactScheduleMatch(context, requested)) {
        return send(response, 409, { error: "preview_context_mismatch" });
      }

      const baseUrl = publicApiBaseUrl(config);
      if (!baseUrl) return send(response, 503, { error: "public_api_not_configured" });

      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
      await store.putSubscription(token, {
        version: 2,
        status: "active",
        ...context,
        plan: "year",
        expiresAt,
        preview: true,
        createdAt,
      });

      return send(response, 201, {
        status: "active",
        preview: true,
        university: context.university,
        program: context.program,
        course: context.course,
        stream: context.stream,
        groupCode: context.groupCode,
        groupId: context.groupId,
        academicYear: context.academicYear,
        semester: context.semester,
        expiresAt,
        subscriptionUrl: `${baseUrl}/api/v1/subscriptions/${token}/calendar.ics`,
      });
    } catch (error) {
      if (["invalid_json", "request_too_large"].includes(error.message)) {
        return send(response, 400, { error: error.message });
      }
      console.error("Preview subscription creation failed", error);
      return send(response, 503, { error: "preview_subscription_unavailable" });
    }
  };
}
