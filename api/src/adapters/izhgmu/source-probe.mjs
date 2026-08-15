import { createHash } from "node:crypto";
import https from "node:https";

const ALLOWED_HOSTS = new Set(["igma.ru", "www.igma.ru"]);
const MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

function sendSpreadsheet(response, buffer, kind) {
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    kind === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel",
  );
  response.setHeader("content-length", String(buffer.length));
  response.setHeader("content-disposition", `attachment; filename="izhgmu-source.${kind}"`);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(buffer);
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

function spreadsheetKind(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zipSignature = `${buffer[2].toString(16).padStart(2, "0")}${buffer[3].toString(16).padStart(2, "0")}`;
    if (["0304", "0506", "0708"].includes(zipSignature)) return "xlsx";
  }
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (buffer.length >= ole.length && buffer.subarray(0, ole.length).equals(ole)) return "xls";
  return null;
}

function headersFromIncoming(incomingHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incomingHeaders || {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value != null) {
      headers.set(name, String(value));
    }
  }
  return headers;
}

async function fetchSpreadsheetOverIpv4(input, options = {}, redirectCount = 0) {
  const url = input instanceof URL ? input : new URL(input);
  if (redirectCount > MAX_REDIRECTS) {
    const error = new Error("too_many_redirects");
    error.code = "ETOOMANYREDIRECTS";
    throw error;
  }

  return await new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      headers: options.headers,
      timeout: REQUEST_TIMEOUT_MS,
    }, (upstream) => {
      const status = upstream.statusCode || 0;
      const location = upstream.headers.location;
      if (status >= 300 && status < 400 && location && options.redirect === "follow") {
        upstream.resume();
        fetchSpreadsheetOverIpv4(new URL(location, url), options, redirectCount + 1).then(resolve, reject);
        return;
      }

      const chunks = [];
      let total = 0;
      upstream.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          const error = new Error("source_too_large");
          error.code = "ETOOLARGE";
          upstream.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      upstream.on("error", reject);
      upstream.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          url: url.toString(),
          headers: headersFromIncoming(upstream.headers),
          async arrayBuffer() {
            return buffer;
          },
        });
      });
    });

    request.on("timeout", () => {
      const error = new Error("upstream_timeout");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
  });
}

export function createIzhgmuSourceProbeHandler({ fetchFn = fetchSpreadsheetOverIpv4 } = {}) {
  return async function izhgmuSourceProbeHandler(request, response) {
    if (request.method !== "GET") {
      return sendJson(response, 405, { status: "error", error: "method_not_allowed" });
    }

    const requestUrl = new URL(request.url, "http://localhost");
    const rawSourceUrl = requestUrl.searchParams.get("url");
    const format = requestUrl.searchParams.get("format") || "json";
    if (!rawSourceUrl) {
      return sendJson(response, 400, { status: "error", error: "url_required" });
    }
    if (format !== "json" && format !== "file") {
      return sendJson(response, 400, { status: "error", error: "invalid_format" });
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
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+IzhGMU source probe)",
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream;q=0.9,*/*;q=0.1",
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

      const kind = spreadsheetKind(buffer);
      const metadata = {
        sourceUrl: sourceUrl.toString(),
        finalUrl: upstream.url || sourceUrl.toString(),
        httpStatus: upstream.status,
        contentType: upstream.headers.get("content-type") || null,
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        spreadsheetKind: kind,
        isSpreadsheet: Boolean(kind),
      };

      if (!kind) {
        return sendJson(response, 422, { status: "not_spreadsheet", ...metadata });
      }

      if (format === "file") {
        return sendSpreadsheet(response, buffer, kind);
      }

      return sendJson(response, 200, { status: "ok", ...metadata });
    } catch (error) {
      const cause = error?.cause || error;
      return sendJson(response, 502, {
        status: "fetch_error",
        sourceUrl: sourceUrl.toString(),
        error: error.message,
        causeCode: cause?.code || null,
        causeMessage: cause?.message || null,
      });
    }
  };
}
