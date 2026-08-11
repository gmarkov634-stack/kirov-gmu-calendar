import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "./classifier.mjs";
import { deriveKgmuPeriod, periodMismatches } from "./period.mjs";
import { publishStagedR, stageRWorkbook } from "./r-pipeline.mjs";
import { readKgmuXlsxStructure } from "./xlsx-reader.mjs";

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
  };
}

export class KgmuIngestServiceV2 {
  constructor({ queue, notifier, config, scheduleStore }) {
    this.queue = queue;
    this.notifier = notifier;
    this.config = config;
    this.scheduleStore = scheduleStore;
  }

  async #notify(review) {
    try {
      return await this.notifier.notifyReviewRequired(review);
    } catch (error) {
      console.error("parser review notification failed", error);
      return { sent: false, reason: error.code || "notification_failed" };
    }
  }

  async #blocked(payload) {
    const review = await this.queue.createReview({
      ...payload,
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
    });
    const notification = await this.#notify(review);
    return {
      reviewId: review.reviewId,
      status: review.status,
      reason: review.reason,
      sourceSha256: review.sourceSha256,
      classification: review.classification,
      derivedPeriod: review.derivedPeriod,
      qa: review.qa,
      notification,
      publicationBlocked: true,
    };
  }

  async ingest(buffer, input = {}) {
    const sourceSha256 = sha256(buffer);
    const meta = metadata(input);
    const sourceKey = await this.queue.storeSource(buffer, sourceSha256, meta.filename);
    const workbook = await readKgmuXlsxStructure(buffer, {
      maxBytes: Number(this.config.kgmuXlsxMaxBytes || 25 * 1024 * 1024),
    });
    const classification = classifyKgmuWorkbook(workbook);
    const derivedPeriod = deriveKgmuPeriod(workbook);
    const mismatches = periodMismatches(meta, derivedPeriod);

    if (mismatches.length) {
      return this.#blocked({
        reason: "PERIOD_MISMATCH",
        sourceSha256,
        sourceKey,
        metadata: meta,
        derivedPeriod,
        periodMismatches: mismatches,
        classification,
      });
    }

    if (classification.type !== "R") {
      return this.#blocked({
        reason: classification.type === "UNKNOWN" ? "UNKNOWN_PATTERN" : `PARSER_${classification.type}_NOT_ENABLED`,
        sourceSha256,
        sourceKey,
        metadata: meta,
        derivedPeriod,
        classification,
      });
    }

    const staged = await stageRWorkbook({
      workbook,
      queue: this.queue,
      sourceSha256,
      sourceKey,
      metadata: meta,
      period: derivedPeriod,
      classification,
    });

    if (staged.qa.status !== "PASS" || !staged.contextComplete) {
      return this.#blocked({
        reason: staged.qa.status !== "PASS" ? "QA_FAILED" : "MISSING_PUBLICATION_CONTEXT",
        sourceSha256,
        sourceKey,
        normalizedKey: staged.normalizedKey,
        metadata: meta,
        derivedPeriod,
        classification,
        qa: staged.qa,
      });
    }

    let review = await this.queue.createReview({
      status: "READY_TO_PUBLISH",
      reason: "QA_PASS_AWAITING_PUBLISH",
      sourceSha256,
      sourceKey,
      normalizedKey: staged.normalizedKey,
      metadata: meta,
      derivedPeriod,
      classification,
      qa: staged.qa,
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
    });

    if (!this.config.kgmuAutoPublish) {
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        sourceSha256,
        classification,
        derivedPeriod,
        qa: staged.qa,
        normalizedKey: staged.normalizedKey,
        notification: { sent: false, reason: "qa_pass_no_notification" },
        publicationBlocked: true,
      };
    }

    try {
      const published = await publishStagedR({ queue: this.queue, scheduleStore: this.scheduleStore, review });
      review = await this.queue.updateReview(review.reviewId, {
        status: "PUBLISHED",
        reason: "QA_PASS_AUTO_PUBLISHED",
        publicationBlocked: false,
        publishedAt: new Date().toISOString(),
        published,
      });
      return { reviewId: review.reviewId, status: review.status, reason: review.reason, sourceSha256, classification, derivedPeriod, qa: staged.qa, published, publicationBlocked: false };
    } catch (error) {
      console.error("KGMU automatic publication failed", error);
      review = await this.queue.updateReview(review.reviewId, {
        status: "REVIEW_REQUIRED",
        reason: "PUBLICATION_FAILED",
        publicationBlocked: true,
        publicationError: String(error?.message || error),
      });
      const notification = await this.#notify(review);
      return { reviewId: review.reviewId, status: review.status, reason: review.reason, sourceSha256, classification, derivedPeriod, qa: staged.qa, notification, publicationBlocked: true };
    }
  }

  async publishReview(reviewId) {
    let review = await this.queue.getReview(reviewId);
    if (!review) return null;
    if (review.status === "PUBLISHED") return review;
    if (review.status !== "READY_TO_PUBLISH") {
      const error = new Error("Parser review is not ready to publish");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    const published = await publishStagedR({ queue: this.queue, scheduleStore: this.scheduleStore, review });
    review = await this.queue.updateReview(review.reviewId, {
      status: "PUBLISHED",
      reason: "QA_PASS_MANUALLY_PUBLISHED",
      publicationBlocked: false,
      publishedAt: new Date().toISOString(),
      published,
    });
    return review;
  }
}
