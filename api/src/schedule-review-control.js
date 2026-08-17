import { createPublicKey, verify as verifySignature } from "node:crypto";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const EXPECTED_AUDIENCE = "kgmu-schedule-review";
const EXPECTED_REPOSITORY = "gmarkov634-stack/kirov-gmu-calendar";
const EXPECTED_ACTOR = "gmarkov634-stack";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_COMMAND_AGE_MS = 30 * 60 * 1000;
const REVIEW_ID_RE = /^[a-f0-9-]{36}$/;
const ACTIONS = new Set(["review.create", "review.submit", "review.submit_publish", "review.publish"]);

let jwksCache = { expiresAt: 0, keys: [] };

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function decodeBase64Url(value) { return Buffer.from(String(value), "base64url"); }
function parseJwtPart(value) { return JSON.parse(decodeBase64Url(value).toString("utf8")); }
function audienceMatches(value) { return Array.isArray(value) ? value.includes(EXPECTED_AUDIENCE) : value === EXPECTED_AUDIENCE; }

async function githubJwks(fetchImpl) {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetchImpl(GITHUB_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("oidc_jwks_unavailable");
  const data = await response.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error("oidc_jwks_empty");
  jwksCache = { expiresAt: Date.now() + 5 * 60 * 1000, keys };
  return keys;
}

export async function verifyScheduleReviewOidcToken(token, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("oidc_invalid_token");
  let header;
  let claims;
  try { header = parseJwtPart(parts[0]); claims = parseJwtPart(parts[1]); } catch { throw new Error("oidc_invalid_token"); }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") throw new Error("oidc_invalid_header");
  const keys = await githubJwks(fetchImpl);
  const jwk = keys.find((key) => key?.kid === header.kid && key?.kty === "RSA");
  if (!jwk) throw new Error("oidc_unknown_key");
  const valid = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), decodeBase64Url(parts[2]));
  if (!valid) throw new Error("oidc_invalid_signature");
  const nowSeconds = Math.floor(now / 1000);
  if (claims?.iss !== GITHUB_OIDC_ISSUER || !audienceMatches(claims?.aud)) throw new Error("oidc_invalid_claims");
  if (!Number.isFinite(Number(claims?.exp)) || Number(claims.exp) < nowSeconds - 30) throw new Error("oidc_expired");
  if (Number.isFinite(Number(claims?.nbf)) && Number(claims.nbf) > nowSeconds + 30) throw new Error("oidc_not_yet_valid");
  if (claims?.repository !== EXPECTED_REPOSITORY || claims?.actor !== EXPECTED_ACTOR) throw new Error("oidc_forbidden_identity");
  if (claims?.event_name !== "pull_request") throw new Error("oidc_forbidden_event");
  if (typeof claims?.ref !== "string" || !/^refs\/pull\/\d+\/merge$/.test(claims.ref)) throw new Error("oidc_forbidden_ref");
  return claims;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new Error("invalid_json"); }
}

function bearerToken(request) {
  const match = String(request.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function validCommand(input, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = String(input.id || "").trim();
  const action = String(input.action || "").trim();
  const createdAt = Date.parse(input.createdAt);
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(id) || !ACTIONS.has(action)) return null;
  if (!Number.isFinite(createdAt) || Math.abs(now - createdAt) > MAX_COMMAND_AGE_MS) return null;
  if (action === "review.create") {
    if (!input.review || typeof input.review !== "object" || Array.isArray(input.review)) return null;
    return { id, action, reviewId: null, createdAt: new Date(createdAt).toISOString(), review: input.review, package: null };
  }
  const reviewId = String(input.reviewId || "").trim().toLowerCase();
  if (!REVIEW_ID_RE.test(reviewId)) return null;
  if (action !== "review.publish" && (!input.package || typeof input.package !== "object" || Array.isArray(input.package))) return null;
  return { id, action, reviewId, createdAt: new Date(createdAt).toISOString(), review: null, package: input.package || null };
}

function compactResult(result) {
  if (!result) return null;
  return {
    reviewId: result.reviewId ?? null,
    university: result.university ?? null,
    status: result.status ?? null,
    reason: result.reason ?? null,
    sourceSetDigest: result.sourceSet?.digest ?? null,
    parserType: result.parserType ?? null,
    publicationBlocked: result.publicationBlocked ?? null,
    qa: result.qa ? { status: result.qa.status ?? null, groupCount: result.qa.groupCount ?? null, eventCount: result.qa.eventCount ?? null, groups: result.qa.groups ?? [] } : null,
    published: result.published ? {
      groupCount: result.published.groupCount ?? null,
      eventCount: result.published.eventCount ?? null,
      groups: result.published.groups ?? [],
      publications: Array.isArray(result.published.publications) ? result.published.publications.map((item) => ({ group: item.group ?? null, scheduleVersionId: item.scheduleVersionId ?? null, previousScheduleVersionId: item.previousScheduleVersionId ?? null, diffCounts: item.diff?.counts ?? null, unchanged: item.publication?.unchanged ?? false })) : [],
    } : null,
  };
}

async function executeCommand(command, reviewedService) {
  if (command.action === "review.create") return reviewedService.createReview(command.review);
  if (command.action === "review.publish") return reviewedService.publishReview(command.reviewId);
  return reviewedService.submitCanonical(command.reviewId, command.package, { publish: command.action === "review.submit_publish" });
}

export function createScheduleReviewControlHandler({ reviewedService, fetchImpl = globalThis.fetch, verifyOidcToken, nowFactory = Date.now }) {
  const verifyToken = verifyOidcToken || ((token) => verifyScheduleReviewOidcToken(token, { fetchImpl }));
  return async function handleScheduleReviewControl(request, response) {
    if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
    if (!reviewedService || typeof reviewedService.submitCanonical !== "function" || typeof reviewedService.publishReview !== "function") return sendJson(response, 503, { error: "schedule_review_control_not_configured" });
    try {
      const authToken = bearerToken(request);
      if (!authToken) return sendJson(response, 401, { error: "unauthorized" });
      try { await verifyToken(authToken); } catch (error) {
        console.error("schedule review control auth rejected", error?.message || "unknown");
        return sendJson(response, 403, { error: "forbidden" });
      }
      const command = validCommand(await readJson(request), nowFactory());
      if (!command) return sendJson(response, 400, { error: "invalid_command" });
      if (command.action === "review.create" && typeof reviewedService.createReview !== "function") return sendJson(response, 503, { error: "schedule_review_create_not_configured" });
      const result = await executeCommand(command, reviewedService);
      if (!result) return sendJson(response, 404, { error: "parser_review_not_found" });
      console.log("schedule review control command completed", { id: command.id, action: command.action, reviewId: result.reviewId || command.reviewId });
      return sendJson(response, 200, { ok: true, id: command.id, action: command.action, result: compactResult(result) });
    } catch (error) {
      if (["invalid_json", "request_too_large"].includes(error?.message)) return sendJson(response, 400, { error: error.message });
      if (["REVIEW_NOT_PUBLISHABLE", "NORMALIZED_RESULT_INVALID", "REVIEW_ALREADY_PUBLISHED", "CANONICAL_REVIEW_SOURCE_MISMATCH", "CANONICAL_REVIEW_CONTEXT_MISMATCH", "CANONICAL_REVIEW_GROUPS_INVALID", "CANONICAL_REVIEW_QA_FAILED", "IZHGMU_SOURCE_SET_INVALID", "IZHGMU_CURRENT_PERIOD_REQUIRED", "IZHGMU_CANONICAL_SOURCE_MISMATCH", "IZHGMU_CANONICAL_CONTEXT_MISMATCH", "IZHGMU_CANONICAL_GROUPS_INVALID", "IZHGMU_CANONICAL_QA_FAILED"].includes(error?.code)) {
        return sendJson(response, 409, { error: String(error.code).toLowerCase(), message: String(error.message || error).slice(0, 500) });
      }
      if (error?.code === "PARSER_REVIEW_NOT_FOUND") return sendJson(response, 404, { error: "parser_review_not_found" });
      console.error("schedule review control failed", error);
      return sendJson(response, 502, { error: "schedule_review_control_unavailable" });
    }
  };
}
