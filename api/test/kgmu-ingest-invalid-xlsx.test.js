import test from "node:test";
import assert from "node:assert/strict";
import { KgmuIngestServiceV2 } from "../src/adapters/kgmu/ingest-service-v2.mjs";

function setup() {
  let createdReview = null;
  let notifiedReview = null;
  const queue = {
    storeSource: async () => "parser-staging/kgmu/sources/test/source.xlsx",
    createReview: async (payload) => {
      createdReview = {
        reviewId: "review-invalid-xlsx",
        status: payload.status || "REVIEW_REQUIRED",
        ...payload,
      };
      return createdReview;
    },
  };
  const notifier = {
    notifyReviewRequired: async (review) => {
      notifiedReview = review;
      return { sent: true };
    },
  };
  const service = new KgmuIngestServiceV2({
    queue,
    notifier,
    config: { kgmuXlsxMaxBytes: 1024 * 1024, kgmuAutoPublish: false },
    scheduleStore: {},
  });
  return {
    service,
    getCreatedReview: () => createdReview,
    getNotifiedReview: () => notifiedReview,
  };
}

test("invalid XLSX becomes REVIEW_REQUIRED and sends review notification", async () => {
  const { service, getCreatedReview, getNotifiedReview } = setup();
  const result = await service.ingest(Buffer.from("<html>not an xlsx container</html>"), {
    filename: "3_lech._2_potok.xlsx",
    program: "medicine",
    course: 3,
    academicYear: "2026/27",
    semester: 1,
  });

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.reason, "INVALID_XLSX");
  assert.equal(result.publicationBlocked, true);
  assert.deepEqual(result.notification, { sent: true });
  assert.equal(result.classification.type, "UNKNOWN");
  assert.equal(result.classification.reason, "invalid-xlsx-container");

  const review = getCreatedReview();
  assert.equal(review.reason, "INVALID_XLSX");
  assert.equal(review.publicationBlocked, true);
  assert.equal(review.currentPublishedSchedulePreserved, true);
  assert.equal(review.parserError.code, "INVALID_XLSX");
  assert.equal(getNotifiedReview().reviewId, "review-invalid-xlsx");
});

test("invalid XLSX dry-run stays side-effect free and fail-closed", async () => {
  const { service, getCreatedReview, getNotifiedReview } = setup();
  const result = await service.dryRun(Buffer.from("<html>not an xlsx container</html>"), {
    filename: "broken.xlsx",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.reason, "INVALID_XLSX");
  assert.equal(result.publicationBlocked, true);
  assert.equal(result.classification.type, "UNKNOWN");
  assert.equal(getCreatedReview(), null);
  assert.equal(getNotifiedReview(), null);
});
