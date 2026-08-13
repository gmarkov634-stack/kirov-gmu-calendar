import { createHash } from "node:crypto";

const ALLOWED_HOSTS = new Set(["omsk-osma.ru", "www.omsk-osma.ru"]);
const MAX_BYTES = 25 * 1024 * 1024;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function validateSourceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("source_not_allowed");
  }
  return url;
}

export function createOmgmuSourceProbeHandler({ fetchFn = fetch } = {}) {
  return async function omgmuSourceProbeHandler(request, response) {
    if (request.method !== "GET") {
      return sendJson(response, 405, { status: "error", error: "method_not_allowed" });
    }

    const requestUrl = new URL(request.url, "http://localhost");
    const rawSourceUrl = requestUrl.searchParams.get("url");
    if (!rawSourceUrl) {
      return sendJson(response, 400, { status: "error", error: "url_required" });
    }

    let sourceUrl;
    try {
      sourceUrl = validateSourceUrl(rawSourceUrl);
    } catch (error) {
      return sendJson(response, 400, { status: "error", error: error.message });
    }

    try {
      const upstream = await fetchFn(sourceUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+source probe)",
          Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
        },
      });

      if (!upstream.ok) {
        return sendJson(response, 502, {
          status: "upstream_error",
          sourceUrl: sourceUrl.toString(),
          httpStatus: upstream.status,
          contentType: upstream.headers.get("content-type") || null,
        });
      }

      const declaredLength = Number(upstream.headers.get("content-length") || 0);
      if (declaredLength > MAX_BYTES) {
        return sendJson(response, 413, { status: "error", error: "source_too_large" });
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length > MAX_BYTES) {
        return sendJson(response, 413, { status: "error", error: "source_too_large" });
      }

      const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
      return sendJson(response, isPdf ? 200 : 422, {
        status: isPdf ? "ok" : "not_pdf",
        sourceUrl: sourceUrl.toString(),
        finalUrl: upstream.url || sourceUrl.toString(),
        httpStatus: upstream.status,
        contentType: upstream.headers.get("content-type") || null,
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        isPdf,
      });
    } catch (error) {
      return sendJson(response, 502, {
        status: "fetch_error",
        sourceUrl: sourceUrl.toString(),
        error: error.message,
      });
    }
  };
}
