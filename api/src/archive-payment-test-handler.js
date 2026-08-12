import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeAcademicYear, scheduleContext } from "./order-context.js";
import { YooKassaService } from "./yookassa.js";

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
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

function adminAllowed(request, config) {
  const actual = request.headers["x-admin-token"];
  const expected = config.adminToken;
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

async function readJson(request, limit = 16384) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      const error = new Error("request_too_large");
      error.code = "request_too_large";
      throw error;
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("invalid_json");
    error.code = "invalid_json";
    throw error;
  }
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requestContext(input) {
  const academicYear = normalizeAcademicYear(input?.academicYear);
  const semester = Number(input?.semester);
  const course = Number(input?.course);
  const program = typeof input?.program === "string" ? input.program.trim() : "";
  const groupCode = typeof input?.groupCode === "string" ? input.groupCode.trim() : "";
  if (!academicYear || ![1, 2].includes(semester) || !Number.isInteger(course) || course < 1 || course > 6 || !program || !groupCode) {
    return null;
  }
  return scheduleContext({
    university: "kgmu",
    program,
    course,
    groupCode,
    academicYear,
    semester,
  });
}

export function createArchivePaymentTestHandler({ store, config, payments }) {
  return async function archivePaymentTestHandler(request, response) {
    applyCors(request, response, config);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
    if (config.yookassaTestMode !== true) return send(response, 409, { error: "yookassa_test_mode_required" });
    if (!payments?.enabled) return send(response, 503, { error: "payments_not_configured" });

    try {
      const input = await readJson(request);
      if (!validEmail(input.email)) return send(response, 400, { error: "invalid_email" });
      const context = requestContext(input);
      if (!context) return send(response, 400, { error: "invalid_archive_context" });

      const currentYear = normalizeAcademicYear(config.offerAcademicYear);
      if (context.academicYear === currentYear && context.semester === Number(config.offerSemester)) {
        return send(response, 409, { error: "current_offer_not_archive" });
      }

      const schedule = await store.getSchedule(context);
      if (!schedule) return send(response, 404, { error: "archive_schedule_not_found" });
      const actual = scheduleContext(schedule);
      if (
        actual.university !== "kgmu" ||
        actual.program !== context.program ||
        actual.course !== context.course ||
        actual.groupCode !== context.groupCode ||
        normalizeAcademicYear(actual.academicYear) !== context.academicYear ||
        actual.semester !== context.semester
      ) {
        return send(response, 409, { error: "archive_schedule_context_mismatch" });
      }

      // Use the normal YooKassa order/subscription machinery, but scope the sale period
      // only for this admin-authenticated test instance. Public checkout remains locked
      // to config.offerAcademicYear/config.offerSemester.
      const testConfig = {
        ...config,
        offerAcademicYear: context.academicYear,
        offerSemester: context.semester,
      };
      const testPayments = new YooKassaService({ config: testConfig, store, fetchFn: payments.fetch });
      const payment = await testPayments.create({
        email: input.email.trim().toLowerCase(),
        schedule,
        plan: "year",
      });
      return send(response, 201, {
        ...payment,
        testMode: true,
        archive: {
          program: context.program,
          course: context.course,
          groupCode: context.groupCode,
          academicYear: context.academicYear,
          semester: context.semester,
        },
      });
    } catch (error) {
      console.error("Archived YooKassa test checkout failed", error);
      if (["invalid_json", "request_too_large"].includes(error.code)) return send(response, 400, { error: error.code });
      if (error.code === "offer_expired") return send(response, 409, { error: "offer_expired" });
      return send(response, 503, { error: "archive_test_payment_unavailable" });
    }
  };
}
