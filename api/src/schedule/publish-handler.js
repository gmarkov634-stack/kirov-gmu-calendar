import { createHash, timingSafeEqual } from "node:crypto";
import { publishScheduleBatch } from "./pipeline.js";

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
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

async function readJson(request, limit = 12 * 1024 * 1024) {
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

function compactQa(report) {
  return {
    stage: report.stage,
    publishable: report.publishable,
    errors: report.errors,
    warnings: report.warnings,
    stats: report.stats,
  };
}

export function createSchedulePublishHandler({ store, config }) {
  return async function schedulePublishHandler(request, response) {
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });

    try {
      const input = await readJson(request);
      const incomingBatch = input?.batch || input;
      const result = await publishScheduleBatch({ store, incomingBatch });
      return send(response, 200, {
        status: result.publication?.unchanged ? "unchanged" : "published",
        context: result.context,
        scheduleVersionId: result.batch.schedule.schedule_version_id,
        previousScheduleVersionId: result.batch.schedule.previous_schedule_version_id,
        contentFingerprint: result.batch.schedule.content_fingerprint,
        eventCount: result.eventCount,
        icsBytes: result.icsBytes,
        diff: result.diff,
        inputQa: compactQa(result.inputQa),
        outputQa: compactQa(result.outputQa),
        publication: result.publication,
      });
    } catch (error) {
      if (["invalid_json", "request_too_large"].includes(error.code)) {
        return send(response, 400, { error: error.code });
      }
      if (["SCHEDULE_BATCH_REQUIRED", "SCHEDULE_CONTEXT_INVALID"].includes(error.code)) {
        return send(response, 400, { error: error.code, message: error.message });
      }
      if (error.code === "SCHEDULE_NOT_PUBLISHABLE") {
        return send(response, 409, {
          error: error.code,
          stage: error.stage,
          report: compactQa(error.report),
        });
      }
      console.error("canonical schedule publication failed", error);
      return send(response, 503, { error: "schedule_publication_unavailable" });
    }
  };
}
