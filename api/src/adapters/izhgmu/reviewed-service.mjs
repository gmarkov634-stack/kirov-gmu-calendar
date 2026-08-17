import {
  IZHGMU_CANONICAL_REVIEW_FORMAT,
  IZHGMU_CANONICAL_REVIEW_PARSER_TYPE,
  publishStagedIzhgmuCanonicalReview,
  stageIzhgmuCanonicalReviewPackage,
} from "./canonical-reviewed.mjs";

function createInput(value) {
  if (!value || value.university !== "izhgmu") throw Object.assign(new Error("Invalid IzhGMU review input"), { code: "IZHGMU_SOURCE_SET_INVALID" });
  const academicYear = String(value.academicYear || "");
  const semester = String(value.semester || "");
  const program = String(value.program || "");
  const courses = [...new Set((value.courses || []).map(Number))].sort((a, b) => a - b);
  if (!new Set(["2026-2027", "2026/2027"]).has(academicYear) || semester !== "autumn" || program !== "medicine") {
    throw Object.assign(new Error("IzhGMU review must target medicine 2026/2027 autumn"), { code: "IZHGMU_CURRENT_PERIOD_REQUIRED" });
  }
  if (!courses.length || courses.some((course) => ![1, 2, 3].includes(course))) {
    throw Object.assign(new Error("IzhGMU review courses must be within active scope 1-3"), { code: "IZHGMU_SOURCE_SET_INVALID" });
  }
  return {
    metadata: { program, courses, academicYear: "2026/2027", semester: "autumn" },
    sourceSet: value.sourceSet,
    observation: value.observation || null,
    reason: "IZHGMU_CURRENT_SOURCE_SET_REVIEW_REQUIRED",
  };
}

export class IzhgmuReviewedService {
  constructor({ queue, scheduleStore }) {
    this.university = "izhgmu";
    this.queue = queue;
    this.scheduleStore = scheduleStore;
  }

  async createReview(input) {
    return this.queue.createSourceSetReview(createInput(input));
  }

  async findReview(reviewId) {
    return this.queue.getReview(reviewId);
  }

  async submitCanonical(reviewId, input, { publish = false } = {}) {
    const current = await this.queue.getReview(reviewId);
    if (!current) return null;
    const staged = await stageIzhgmuCanonicalReviewPackage({ input, review: current, queue: this.queue });
    let review = await this.queue.updateReview(reviewId, {
      status: "READY_TO_PUBLISH",
      reason: "IZHGMU_SOURCE_SET_CANONICAL_QA_PASS",
      parserType: IZHGMU_CANONICAL_REVIEW_PARSER_TYPE,
      normalizedKey: staged.normalizedKey,
      qa: staged.qa,
      normalizer: {
        type: "chatgpt-reviewed",
        rulesRevision: staged.rulesRevision,
        format: IZHGMU_CANONICAL_REVIEW_FORMAT,
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
      const error = new Error("IzhGMU review is not ready to publish");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    return this.#publishReady(review);
  }

  async #publishReady(review) {
    const published = await publishStagedIzhgmuCanonicalReview({ queue: this.queue, scheduleStore: this.scheduleStore, review });
    return this.queue.updateReview(review.reviewId, {
      status: "PUBLISHED",
      reason: "IZHGMU_SOURCE_SET_CANONICAL_PUBLISHED",
      publicationBlocked: false,
      currentPublishedSchedulePreserved: false,
      publishedAt: new Date().toISOString(),
      published,
    });
  }
}
