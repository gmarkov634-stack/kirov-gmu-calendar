import { createHash } from "node:crypto";
import { publishStagedReviewedBundle, stageReviewedBundle } from "./reviewed-bundle.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function metadata(input = {}) {
  const course = Number(input.course);
  const semester = Number(input.semester);
  return {
    filename: String(input.filename || "schedule.xlsx").slice(0, 200),
    program: input.program ? String(input.program).slice(0, 80) : null,
    course: Number.isInteger(course) && course > 0 ? course : null,
    academicYear: input.academicYear ? String(input.academicYear).slice(0, 20) : null,
    semester: [1, 2].includes(semester) ? semester : null,
    groupRange: input.groupRange ? String(input.groupRange).slice(0, 40) : null,
    sourceUrl: input.sourceUrl ? String(input.sourceUrl).slice(0, 1000) : null,
  };
}

export class KgmuReviewedService {
  constructor({ queue, notifier, config, scheduleStore, fetchFn = fetch }) {
    this.queue = queue;
    this.notifier = notifier;
    this.config = config;
    this.scheduleStore = scheduleStore;
    this.fetch = fetchFn;
  }

  async #notifyReview(review) {
    if (typeof this.notifier?.notifyReviewRequired !== "function") return { sent: false, reason: "review_notification_unsupported" };
    try {
      return await this.notifier.notifyReviewRequired(review);
    } catch (error) {
      console.error("manual normalization notification failed", error);
      return { sent: false, reason: error?.code || "notification_failed" };
    }
  }

  async #notifyReady(review) {
    if (typeof this.notifier?.notifyReadyToPublish !== "function") return { sent: false, reason: "ready_notification_unsupported" };
    try {
      return await this.notifier.notifyReadyToPublish(review);
    } catch (error) {
      console.error("reviewed bundle ready notification failed", error);
      return { sent: false, reason: error?.code || "notification_failed" };
    }
  }

  async retryNotification(reviewId) {
    const review = await this.queue.getReview(reviewId);
    if (!review) return { sent: false, terminal: true, reason: "review_not_found" };
    if (review.status === "PUBLISHED") return { sent: true, skipped: true, reason: "review_already_published" };
    if (review.status === "READY_TO_PUBLISH") return this.#notifyReady(review);
    return this.#notifyReview(review);
  }

  async observeSource(buffer, input = {}) {
    const sourceSha256 = sha256(buffer);
    const meta = metadata(input);
    const sourceKey = await this.queue.storeSource(buffer, sourceSha256, meta.filename);
    const review = await this.queue.createReview({
      status: "REVIEW_REQUIRED",
      reason: "MANUAL_NORMALIZATION_REQUIRED",
      parserType: "REVIEWED_JSON",
      sourceSha256,
      sourceKey,
      metadata: meta,
      derivedPeriod: meta.academicYear && meta.semester
        ? { academicYear: meta.academicYear, semester: meta.semester }
        : null,
      classification: {
        type: "MANUAL",
        confidence: "high",
        reason: "server-xlsx-parsing-disabled",
        features: {
          groupRange: meta.groupRange,
          sourceUrl: meta.sourceUrl,
        },
      },
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
    });
    const notification = await this.#notifyReview(review);
    return {
      reviewId: review.reviewId,
      status: review.status,
      reason: review.reason,
      parserType: review.parserType,
      sourceSha256,
      sourceKey,
      metadata: meta,
      notification,
      publicationBlocked: true,
    };
  }

  async #publishReady(review) {
    const published = await publishStagedReviewedBundle({
      queue: this.queue,
      scheduleStore: this.scheduleStore,
      review,
    });
    return this.queue.updateReview(review.reviewId, {
      status: "PUBLISHED",
      reason: "REVIEWED_JSON_PUBLISHED",
      publicationBlocked: false,
      publishedAt: new Date().toISOString(),
      published,
    });
  }

  async submit(bundle, { publish = false } = {}) {
    const staged = await stageReviewedBundle({
      bundle,
      queue: this.queue,
      config: this.config,
      fetchFn: this.fetch,
    });
    let review = await this.queue.createReview({
      status: "READY_TO_PUBLISH",
      reason: "REVIEWED_JSON_QA_PASS",
      parserType: "REVIEWED_JSON",
      sourceSha256: staged.sourceSha256,
      normalizedKey: staged.normalizedKey,
      metadata: {
        filename: staged.source.filename,
        program: staged.program,
        course: staged.course,
        academicYear: staged.academicYear,
        semester: staged.semester,
        groupRange: staged.source.groupRange,
        sourceUrl: staged.source.url,
      },
      derivedPeriod: { academicYear: staged.academicYear, semester: staged.semester },
      classification: {
        type: "REVIEWED_JSON",
        confidence: "high",
        reason: "chatgpt-reviewed-normalization",
        features: { groupCodes: staged.schedules.map((schedule) => schedule.group.code) },
      },
      qa: staged.qa,
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
      normalizer: staged.normalizer,
      sourceVerification: staged.sourceVerification,
    });

    if (!publish) {
      const notification = await this.#notifyReady(review);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256: review.sourceSha256,
        qa: review.qa,
        normalizedKey: review.normalizedKey,
        notification,
        publicationBlocked: true,
      };
    }

    try {
      review = await this.#publishReady(review);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256: review.sourceSha256,
        qa: review.qa,
        published: review.published,
        publicationBlocked: false,
      };
    } catch (error) {
      console.error("reviewed JSON publication failed", error);
      review = await this.queue.updateReview(review.reviewId, {
        status: "REVIEW_REQUIRED",
        reason: "PUBLICATION_FAILED",
        publicationBlocked: true,
        publicationError: String(error?.message || error).slice(0, 1000),
      });
      const notification = await this.#notifyReview(review);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256: review.sourceSha256,
        qa: review.qa,
        notification,
        publicationBlocked: true,
      };
    }
  }

  async publishReview(reviewId) {
    const review = await this.queue.getReview(reviewId);
    if (!review) return null;
    if (review.status === "PUBLISHED") return review;
    if (review.status !== "READY_TO_PUBLISH" || review.parserType !== "REVIEWED_JSON") {
      const error = new Error("Reviewed JSON review is not ready to publish");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    return this.#publishReady(review);
  }
}
