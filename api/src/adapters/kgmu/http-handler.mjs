import { createHash, timingSafeEqual } from "node:crypto";

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

function sendXlsx(response, body, filename = "schedule.xlsx") {
  const safe = String(filename || "schedule.xlsx").replace(/[\r\n]/g, " ").slice(0, 180) || "schedule.xlsx";
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="schedule.xlsx"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
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
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

async function readBuffer(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error("request_too_large");
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit = 20 * 1024 * 1024) {
  const buffer = await readBuffer(request, limit);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    const error = new Error("Request body is not valid JSON");
    error.code = "REVIEWED_BUNDLE_INVALID";
    throw error;
  }
}

function metadataFromUrl(url) {
  return {
    filename: url.searchParams.get("filename") || "schedule.xlsx",
    program: url.searchParams.get("program"),
    course: url.searchParams.get("course"),
    academicYear: url.searchParams.get("academicYear"),
    semester: url.searchParams.get("semester"),
    groupRange: url.searchParams.get("groupRange"),
    sourceUrl: url.searchParams.get("sourceUrl"),
  };
}

function xlsxError(response, error, fallback) {
  if (error.code === "request_too_large" || error.code === "XLSX_TOO_LARGE") return send(response, 413, { error: "xlsx_too_large" });
  if (error.code === "INVALID_XLSX") return send(response, 400, { error: "invalid_xlsx" });
  return send(response, 503, { error: fallback });
}

function reviewedError(response, error) {
  const code = String(error?.code || "REVIEWED_BUNDLE_INVALID");
  const body = { error: code.toLowerCase(), message: String(error?.message || error).slice(0, 500) };
  if (error?.details) body.details = error.details;
  if (code === "request_too_large") return send(response, 413, body);
  if (code === "PARSER_REVIEW_NOT_FOUND") return send(response, 404, body);
  if ([
    "REVIEWED_SOURCE_SHA_MISMATCH",
    "REVIEWED_BUNDLE_GROUPS_INVALID",
    "REVIEWED_BUNDLE_PERIOD_INVALID",
    "REVIEWED_BUNDLE_DUPLICATE_EVENT",
    "REVIEW_ALREADY_PUBLISHED",
    "CANONICAL_REVIEW_SOURCE_MISMATCH",
    "CANONICAL_REVIEW_CONTEXT_MISMATCH",
    "CANONICAL_REVIEW_GROUPS_INVALID",
    "CANONICAL_REVIEW_QA_FAILED",
    "CANONICAL_PUBLICATION_PARTIAL",
  ].includes(code)) return send(response, 409, body);
  if ([
    "REVIEWED_SOURCE_UNAVAILABLE",
    "REVIEWED_SOURCE_TOO_LARGE",
    "ATOMIC_PUBLICATION_UNAVAILABLE",
    "CANONICAL_REVIEW_STAGING_UNAVAILABLE",
    "CANONICAL_PUBLICATION_UNAVAILABLE",
  ].includes(code)) return send(response, 503, body);
  return send(response, 400, body);
}

export function createKgmuParserHandler({ service, reviewedService, queue, watcher, notifier, config }) {
  return async function kgmuParserHandler(request, response) {
    applyCors(request, response, config);
    if (request.method === "OPTIONS") return sendEmpty(response);
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
    const url = new URL(request.url, "http://localhost");

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/reviewed-bundle") {
      if (typeof reviewedService?.submit !== "function") return send(response, 503, { error: "reviewed_bundle_unavailable" });
      try {
        const bundle = await readJson(request);
        const publish = url.searchParams.get("publish") === "true";
        const result = await reviewedService.submit(bundle, { publish });
        return send(response, publish ? 200 : 202, result);
      } catch (error) {
        console.error("KGMU reviewed bundle failed", error);
        return reviewedError(response, error);
      }
    }

    const canonicalMatch = url.pathname.match(/^\/api\/v1\/admin\/parser-reviews\/([a-f0-9-]{36})\/canonical$/);
    if (request.method === "POST" && canonicalMatch) {
      if (typeof reviewedService?.submitCanonical !== "function") return send(response, 503, { error: "canonical_review_unavailable" });
      try {
        const input = await readJson(request);
        const publish = url.searchParams.get("publish") === "true";
        const result = await reviewedService.submitCanonical(canonicalMatch[1], input, { publish });
        if (!result) return send(response, 404, { error: "parser_review_not_found" });
        return send(response, publish ? 200 : 202, result);
      } catch (error) {
        console.error("KGMU canonical review failed", error);
        return reviewedError(response, error);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/dry-run") {
      if (config.kgmuXlsxParserEnabled === false) return send(response, 410, { error: "xlsx_parser_retired", normalization: "reviewed_json" });
      if (typeof service?.dryRun !== "function") return send(response, 503, { error: "kgmu_dry_run_unavailable" });
      try {
        const limit = Number(config.kgmuXlsxMaxBytes || 25 * 1024 * 1024);
        const buffer = await readBuffer(request, limit);
        return send(response, 200, await service.dryRun(buffer, metadataFromUrl(url)));
      } catch (error) {
        console.error("KGMU dry run failed", error);
        return xlsxError(response, error, "kgmu_dry_run_unavailable");
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/ingest") {
      try {
        const limit = Number(config.kgmuXlsxMaxBytes || 25 * 1024 * 1024);
        const buffer = await readBuffer(request, limit);
        const metadata = metadataFromUrl(url);
        if (config.kgmuXlsxParserEnabled === false) {
          if (typeof reviewedService?.observeSource !== "function") return send(response, 503, { error: "reviewed_source_ingest_unavailable" });
          const result = await reviewedService.observeSource(buffer, metadata);
          return send(response, 202, result);
        }
        if (typeof service?.ingest !== "function") return send(response, 503, { error: "kgmu_ingest_unavailable" });
        const result = await service.ingest(buffer, metadata);
        return send(response, 202, result);
      } catch (error) {
        console.error("KGMU ingest failed", error);
        return xlsxError(response, error, "kgmu_ingest_unavailable");
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/watch") {
      if (!watcher) return send(response, 503, { error: "kgmu_watcher_unavailable" });
      try {
        return send(response, 200, await watcher.run());
      } catch (error) {
        console.error("KGMU source watcher failed", error);
        return send(response, 503, { error: "kgmu_watch_unavailable" });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/email-test") {
      if (typeof notifier?.notifySystemTest !== "function") return send(response, 503, { error: "email_notifier_unavailable" });
      try {
        const result = await notifier.notifySystemTest();
        if (!result?.sent) return send(response, 503, { error: result?.reason || "email_not_configured" });
        return send(response, 200, { sent: true });
      } catch (error) {
        console.error("KGMU Email test failed", error);
        return send(response, 503, { error: "email_test_failed" });
      }
    }

    const publishMatch = url.pathname.match(/^\/api\/v1\/admin\/parser-reviews\/([a-f0-9-]{36})\/publish$/);
    if (request.method === "POST" && publishMatch) {
      try {
        let current = null;
        if (typeof queue?.getReview === "function") current = await queue.getReview(publishMatch[1]);
        const publisher = current?.parserType === "REVIEWED_JSON" ? reviewedService : service;
        if (typeof publisher?.publishReview !== "function") return send(response, 503, { error: "parser_review_publish_unavailable" });
        const review = await publisher.publishReview(publishMatch[1]);
        if (!review) return send(response, 404, { error: "parser_review_not_found" });
        return send(response, 200, review);
      } catch (error) {
        if (["REVIEW_NOT_PUBLISHABLE", "NORMALIZED_RESULT_INVALID"].includes(error.code)) {
          return send(response, 409, { error: String(error.code).toLowerCase() });
        }
        console.error("parser review publication failed", error);
        return send(response, 503, { error: "parser_review_publish_unavailable" });
      }
    }

    const sourceMatch = url.pathname.match(/^\/api\/v1\/admin\/parser-reviews\/([a-f0-9-]{36})\/source$/);
    if (request.method === "GET" && sourceMatch) {
      try {
        const review = await queue.getReview(sourceMatch[1]);
        if (!review) return send(response, 404, { error: "parser_review_not_found" });
        const source = await queue.getSource(review.sourceKey);
        if (!source) return send(response, 404, { error: "parser_review_source_not_found" });
        return sendXlsx(response, source, review.metadata?.filename || "schedule.xlsx");
      } catch (error) {
        console.error("parser review source read failed", error);
        return send(response, 503, { error: "parser_review_source_unavailable" });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/v1/admin/parser-reviews") {
      try {
        const reviews = await queue.listReviews({
          status: url.searchParams.get("status") || undefined,
          limit: Number(url.searchParams.get("limit") || 100),
        });
        return send(response, 200, { reviews });
      } catch (error) {
        console.error("parser review list failed", error);
        return send(response, 503, { error: "parser_reviews_unavailable" });
      }
    }

    const match = url.pathname.match(/^\/api\/v1\/admin\/parser-reviews\/([a-f0-9-]{36})$/);
    if (request.method === "GET" && match) {
      try {
        const review = await queue.getReview(match[1]);
        if (!review) return send(response, 404, { error: "parser_review_not_found" });
        return send(response, 200, review);
      } catch (error) {
        console.error("parser review read failed", error);
        return send(response, 503, { error: "parser_review_unavailable" });
      }
    }

    return send(response, 404, { error: "not_found" });
  };
}
