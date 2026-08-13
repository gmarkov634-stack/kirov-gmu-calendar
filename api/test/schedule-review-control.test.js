import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createScheduleReviewControlHandler,
  verifyScheduleReviewOidcToken,
} from "../src/schedule-review-control.js";

const NOW = Date.parse("2026-08-13T10:00:00.000Z");
const CREATED_AT = "2026-08-13T09:59:00.000Z";
const REVIEW_ID = "123e4567-e89b-12d3-a456-426614174000";

function fakeRequest(body, authorization = "Bearer test-oidc") {
  return {
    method: "POST",
    headers: authorization ? { authorization } : {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}

function parse(response) {
  return JSON.parse(response.body || "{}");
}

function command(action, extra = {}) {
  return {
    id: `schedule-${action.replaceAll(".", "-")}-0001`,
    action,
    createdAt: CREATED_AT,
    reviewId: REVIEW_ID,
    ...extra,
  };
}

function handler(reviewedService, extra = {}) {
  return createScheduleReviewControlHandler({
    reviewedService,
    nowFactory: () => NOW,
    verifyOidcToken: async (token) => {
      assert.equal(token, "test-oidc");
      return { repository: "gmarkov634-stack/kirov-gmu-calendar" };
    },
    ...extra,
  });
}

function jwt(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

test("schedule control OIDC accepts only the dedicated audience and repository PR identity", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "schedule-review-control-key";
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.use = "sig";
  jwk.alg = "RS256";
  const nowSeconds = Math.floor(NOW / 1000);
  const baseClaims = {
    iss: "https://token.actions.githubusercontent.com",
    exp: nowSeconds + 300,
    nbf: nowSeconds - 10,
    repository: "gmarkov634-stack/kirov-gmu-calendar",
    actor: "gmarkov634-stack",
    event_name: "pull_request",
    ref: "refs/pull/81/merge",
  };
  const fetchImpl = async (url) => {
    assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
    return { ok: true, async json() { return { keys: [jwk] }; } };
  };

  const claims = await verifyScheduleReviewOidcToken(jwt(privateKey, kid, {
    ...baseClaims,
    aud: "kgmu-schedule-review",
  }), { now: NOW, fetchImpl });
  assert.equal(claims.actor, "gmarkov634-stack");

  await assert.rejects(
    verifyScheduleReviewOidcToken(jwt(privateKey, kid, { ...baseClaims, aud: "kgmu-vk-control" }), { now: NOW, fetchImpl }),
    /oidc_invalid_claims/,
  );
});

test("review.submit sends canonical package to the existing parser review", async () => {
  let call = null;
  const reviewedService = {
    submitCanonical: async (reviewId, pkg, options) => {
      call = { reviewId, pkg, options };
      return {
        reviewId,
        status: "READY_TO_PUBLISH",
        reason: "CANONICAL_REVIEWED_JSON_QA_PASS",
        parserType: "REVIEWED_JSON",
        publicationBlocked: true,
        qa: { status: "PASS", groupCount: 1, eventCount: 10, groups: ["401"] },
      };
    },
    publishReview: async () => null,
  };
  const response = fakeResponse();
  const pkg = { format: "canonical-reviewed/v1", rules_revision: "R69", batches: [{}] };
  await handler(reviewedService)(fakeRequest(command("review.submit", { package: pkg })), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(call, { reviewId: REVIEW_ID, pkg, options: { publish: false } });
  assert.equal(parse(response).result.status, "READY_TO_PUBLISH");
  assert.deepEqual(parse(response).result.qa.groups, ["401"]);
});

test("review.submit_publish publishes through canonical review service and returns compact diff metadata", async () => {
  const reviewedService = {
    submitCanonical: async (reviewId, pkg, options) => {
      assert.equal(reviewId, REVIEW_ID);
      assert.equal(pkg.format, "canonical-reviewed/v1");
      assert.equal(options.publish, true);
      return {
        reviewId,
        status: "PUBLISHED",
        reason: "CANONICAL_REVIEWED_JSON_PUBLISHED",
        parserType: "REVIEWED_JSON",
        publicationBlocked: false,
        qa: { status: "PASS", groupCount: 1, eventCount: 1, groups: ["401"] },
        published: {
          groupCount: 1,
          eventCount: 1,
          groups: ["401"],
          publications: [{
            group: "401",
            scheduleVersionId: "ver_new",
            previousScheduleVersionId: "ver_old",
            diff: { counts: { added: 0, changed: 1, removed: 0, unchanged: 0, total_new: 1 } },
            publication: { unchanged: false },
          }],
        },
      };
    },
    publishReview: async () => null,
  };
  const response = fakeResponse();
  await handler(reviewedService)(fakeRequest(command("review.submit_publish", {
    package: { format: "canonical-reviewed/v1", rules_revision: "R69", batches: [{}] },
  })), response);
  assert.equal(response.statusCode, 200);
  const body = parse(response);
  assert.equal(body.result.status, "PUBLISHED");
  assert.equal(body.result.published.publications[0].scheduleVersionId, "ver_new");
  assert.equal(body.result.published.publications[0].diffCounts.changed, 1);
});

test("review.publish uses the existing dashboard publication action", async () => {
  let publishedId = null;
  const response = fakeResponse();
  await handler({
    submitCanonical: async () => null,
    publishReview: async (reviewId) => {
      publishedId = reviewId;
      return { reviewId, status: "PUBLISHED", reason: "CANONICAL_REVIEWED_JSON_PUBLISHED", publicationBlocked: false };
    },
  })(fakeRequest(command("review.publish")), response);
  assert.equal(response.statusCode, 200);
  assert.equal(publishedId, REVIEW_ID);
  assert.equal(parse(response).result.status, "PUBLISHED");
});

test("schedule review control requires OIDC and rejects stale commands", async () => {
  const reviewedService = { submitCanonical: async () => null, publishReview: async () => null };
  const unauthorized = fakeResponse();
  await handler(reviewedService)(fakeRequest(command("review.publish"), ""), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const stale = fakeResponse();
  await handler(reviewedService)(fakeRequest({
    ...command("review.publish"),
    createdAt: "2026-08-13T08:00:00.000Z",
  }), stale);
  assert.equal(stale.statusCode, 400);
  assert.deepEqual(parse(stale), { error: "invalid_command" });
});
