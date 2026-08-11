import { createHash, timingSafeEqual } from "node:crypto";

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

function metadataFromUrl(url) {
  return {
    filename: url.searchParams.get("filename") || "schedule.xlsx",
    program: url.searchParams.get("program"),
    course: url.searchParams.get("course"),
    academicYear: url.searchParams.get("academicYear"),
    semester: url.searchParams.get("semester"),
  };
}

export function createKgmuParserHandler({ service, queue, config }) {
  return async function kgmuParserHandler(request, response) {
    if (!config.adminToken || config.adminToken.length < 32) return send(response, 503, { error: "admin_not_configured" });
    if (!adminAllowed(request, config)) return send(response, 403, { error: "admin_forbidden" });
    const url = new URL(request.url, "http://localhost");

    if (request.method === "POST" && url.pathname === "/api/v1/admin/kgmu/ingest") {
      try {
        const limit = Number(config.kgmuXlsxMaxBytes || 25 * 1024 * 1024);
        const buffer = await readBuffer(request, limit);
        const result = await service.ingest(buffer, metadataFromUrl(url));
        return send(response, 202, result);
      } catch (error) {
        console.error("KGMU ingest failed", error);
        if (error.code === "request_too_large" || error.code === "XLSX_TOO_LARGE") return send(response, 413, { error: "xlsx_too_large" });
        if (error.code === "INVALID_XLSX") return send(response, 400, { error: "invalid_xlsx" });
        return send(response, 503, { error: "kgmu_ingest_unavailable" });
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
