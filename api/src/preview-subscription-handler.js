import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeAcademicYear, scheduleContext } from "./order-context.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROGRAMS = new Set(["medicine", "pediatrics", "dentistry", "foreign"]);
const GROUP_RE = /^\d{3}(?:и)?$/i;

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

export function createPreviewSubscriptionHandler({ store, config }) {
  return async function previewSubscriptionHandler(request, response) {
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });

    try {
      const input = await readJson(request);
      const university = String(input.university || "kgmu").trim();
      const program = String(input.program || "").trim();
      const course = Number(input.course);
      const groupCode = String(input.groupCode || input.group || "").trim().replace(/i$/i, "и");
      const academicYear = normalizeAcademicYear(input.academicYear);
      const semester = Number(input.semester);
      const days = Math.min(30, Math.max(1, Number(input.days || 7)));

      if (
        university !== "kgmu" ||
        !PROGRAMS.has(program) ||
        !Number.isInteger(course) || course < 1 || course > 6 ||
        !GROUP_RE.test(groupCode) ||
        !academicYear ||
        ![1, 2].includes(semester)
      ) {
        return send(response, 400, { error: "invalid_preview_context" });
      }

      const groupId = `kgmu:${program}:${course}:${groupCode}`;
      const schedule = await store.getSchedule({
        university,
        program,
        course,
        groupId,
        groupCode,
        academicYear,
        semester,
      });
      if (!schedule) return send(response, 404, { error: "schedule_not_published" });

      const context = scheduleContext(schedule);
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
        groupCode: context.groupCode,
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
