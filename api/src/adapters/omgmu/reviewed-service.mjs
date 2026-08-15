import {
  OMGMU_CANONICAL_REVIEW_FORMAT,
  OMGMU_CANONICAL_REVIEW_PARSER_TYPE,
  publishStagedOmgmuCanonicalReview,
  stageOmgmuCanonicalReviewPackage,
} from "./canonical-reviewed.mjs";

export class OmgmuReviewedService {
  constructor({ queue, scheduleStore }) {
    this.queue = queue;
    this.scheduleStore = scheduleStore;
  }

  async submitCanonical(reviewId, input, { publish = false } = {}) {
    const current = await this.queue.getReview(reviewId);
    if (!current) return null;
    const staged = await stageOmgmuCanonicalReviewPackage({ input, review: current, queue: this.queue });
    let review = await this.queue.updateReview(reviewId, {
      status: "READY_TO_PUBLISH",
      reason: "OMGMU_CANONICAL_REVIEWED_JSON_QA_PASS",
      parserType: OMGMU_CANONICAL_REVIEW_PARSER_TYPE,
      normalizedKey: staged.normalizedKey,
      qa: staged.qa,
      normalizer: {
        type: "chatgpt-reviewed",
        rulesRevision: staged.rulesRevision,
        format: OMGMU_CANONICAL_REVIEW_FORMAT,
      },
      classification: {
        type: "OMGMU_CANONICAL_REVIEWED_JSON",
        confidence: "high",
        reason: "chatgpt-canonical-schedule-batch",
        features: { groups: staged.qa.groups, reviewedSourceEventCount: staged.qa.reviewedSourceEventCount },
      },
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
    });
    if (publish) review = await this.#publishReady(review);
    return review;
  }

  async publishReview(reviewId) {
    const review = await this.queue.getReview(reviewId);
    if (!review) return null;
    if (review.status === "PUBLISHED") return review;
    if (review.status !== "READY_TO_PUBLISH") {
      const error = new Error("ОмГМУ review is not ready to publish");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    return this.#publishReady(review);
  }

  async #publishReady(review) {
    const published = await publishStagedOmgmuCanonicalReview({
      queue: this.queue,
      scheduleStore: this.scheduleStore,
      review,
    });
    return this.queue.updateReview(review.reviewId, {
      status: "PUBLISHED",
      reason: "OMGMU_CANONICAL_REVIEWED_JSON_PUBLISHED",
      publicationBlocked: false,
      currentPublishedSchedulePreserved: false,
      publishedAt: new Date().toISOString(),
      published,
    });
  }
}
