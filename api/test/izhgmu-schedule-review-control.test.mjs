import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createScheduleReviewControlHandler } from "../src/schedule-review-control.js";

const NOW = Date.parse("2026-08-17T16:00:00.000Z");
const URL = "https://www.igma.ru/schedule/medicine1.xlsx";
const SHA = "a".repeat(64);
const DIGEST = createHash("sha256").update(`${URL}\0${SHA}`).digest("hex");

function request(body) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
}

function response() {
  return {
    statusCode: null,
    body: "",
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = "") { this.body = String(body); },
  };
}

function command() {
  return {
    id: "izhgmu-review-create-0001",
    action: "review.create",
    createdAt: "2026-08-17T15:59:00.000Z",
    review: {
      university: "izhgmu",
      program: "medicine",
      courses: [1, 2, 3],
      academicYear: "2026/2027",
      semester: "autumn",
      sourceSet: { digest: DIGEST, members: [{ url: URL, filename: "medicine1.xlsx", sha256: SHA }] },
    },
  };
}

test("OIDC schedule control creates IzhGMU source-set review without publishing", async () => {
  let received = null;
  const service = {
    createReview: async (input) => {
      received = structuredClone(input);
      return {
        reviewId: "123e4567-e89b-12d3-a456-426614174000",
        university: "izhgmu",
        status: "REVIEW_REQUIRED",
        reason: "IZHGMU_CURRENT_SOURCE_SET_REVIEW_REQUIRED",
        sourceSet: input.sourceSet,
        publicationBlocked: true,
      };
    },
    submitCanonical: async () => null,
    publishReview: async () => null,
  };
  const handler = createScheduleReviewControlHandler({
    reviewedService: service,
    nowFactory: () => NOW,
    verifyOidcToken: async (token) => {
      assert.equal(token, "test-oidc");
      return { repository: "gmarkov634-stack/kirov-gmu-calendar" };
    },
  });
  const res = response();
  await handler(request(command()), res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.university, "izhgmu");
  assert.equal(received.sourceSet.digest, DIGEST);
  const body = JSON.parse(res.body);
  assert.equal(body.result.status, "REVIEW_REQUIRED");
  assert.equal(body.result.sourceSetDigest, DIGEST);
  assert.equal(body.result.publicationBlocked, true);
});

test("review.create remains unavailable when the router has no create target", async () => {
  const handler = createScheduleReviewControlHandler({
    reviewedService: { submitCanonical: async () => null, publishReview: async () => null },
    nowFactory: () => NOW,
    verifyOidcToken: async () => ({}),
  });
  const res = response();
  await handler(request(command()), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "schedule_review_create_not_configured");
});
