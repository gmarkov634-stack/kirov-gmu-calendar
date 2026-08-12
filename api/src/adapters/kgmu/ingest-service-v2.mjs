import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "./classifier.mjs";
import { publishStagedC, stageCWorkbook } from "./c-pipeline.mjs";
import { deriveKgmuPeriod, periodMismatches } from "./period.mjs";
import { publishStagedR, stageRWorkbook } from "./r-pipeline.mjs";
import { publishStagedS, stageSWorkbook } from "./s-pipeline.mjs";
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

function parserFor(type) {
  if (type === "R") return { stage: stageRWorkbook, publish: publishStagedR };
  if (type === "C") return { stage: stageCWorkbook, publish: publishStagedC };
  if (type === "S") return { stage: stageSWorkbook, publish: publishStagedS };
  return null;
}

function dryRunSummary(staged) {
  const schedules = Array.isArray(staged?.schedules) ? staged.schedules : [];
  const groups = [...new Set(schedules.map((schedule) => schedule?.group?.code).filter(Boolean))];
  return {
    qa: staged?.qa || null,
    contextComplete: Boolean(staged?.contextComplete),
    scheduleCount: schedules.length,
    eventCount: schedules.reduce((sum, schedule) => sum + (Array.isArray(schedule?.events) ? schedule.events.length : 0), 0),
    groups,
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

  async #notifyReady(review) {
    if (typeof this.notifier?.notifyReadyToPublish !== "function") return { sent: false, reason: "ready_notification_unsupported" };
    try {
      return await this.notifier.notifyReadyToPublish(review);
    } catch (error) {
      console.error("parser ready notification failed", error);
      return { sent: false, reason: error.code || "notification_failed" };
    }
  }

  async retryNotification(reviewId) {
    const review = await this.queue.getReview(reviewId);
    if (!review) return { sent: false, terminal: true, reason: "review_not_found" };
    if (review.status === "PUBLISHED") return { sent: true, skipped: true, reason: "review_already_published" };
    if (review.status === "READY_TO_PUBLISH") return this.#notifyReady(review);
    return this.#notify(review);
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

  async #publishReady(review, publisher) {
    const published = await publisher({
      queue: this.queue,
      scheduleStore: this.scheduleStore,
      review,
    });
    return this.queue.updateReview(review.reviewId, {
      status: "PUBLISHED",
      reason: "QA_PASS_PUBLISHED",
      publicationBlocked: false,
      publishedAt: new Date().toISOString(),
      published,
    });
  }

  async dryRun(buffer, input = {}) {
    const sourceSha256 = sha256(buffer);
    const meta = metadata(input);
    const workbook = await readKgmuXlsxStructure(buffer, {
      maxBytes: Number(this.config.kgmuXlsxMaxBytes || 25 * 1024 * 1024),
    });
    const classification = classifyKgmuWorkbook(workbook);
    const derivedPeriod = deriveKgmuPeriod(workbook);
    const mismatches = periodMismatches(meta, derivedPeriod);
    const base = {
      dryRun: true,
      sourceSha256,
      metadata: meta,
      classification,
      derivedPeriod,
      publicationBlocked: true,
    };

    if (mismatches.length) {
      return {
        ...base,
        status: "REVIEW_REQUIRED",
        reason: "PERIOD_MISMATCH",
        periodMismatches: mismatches,
      };
    }

    const parser = parserFor(classification.type);
    if (!parser) {
      return {
        ...base,
        status: "REVIEW_REQUIRED",
        reason: classification.type === "UNKNOWN" ? "UNKNOWN_PATTERN" : `PARSER_${classification.type}_NOT_ENABLED`,
      };
    }

    let staged;
    try {
      staged = await parser.stage({
        workbook,
        queue: { storeNormalized: async () => null },
        sourceSha256,
        sourceKey: null,
        metadata: meta,
        period: derivedPeriod,
        classification,
      });
    } catch (error) {
      return {
        ...base,
        status: "REVIEW_REQUIRED",
        reason: `PARSER_${classification.type}_FAILED`,
        parserType: classification.type,
        parserError: {
          code: error?.code || `KGMU_${classification.type}_FAILED`,
          message: String(error?.message || error).slice(0, 500),
        },
      };
    }

    const summary = dryRunSummary(staged);
    const passed = staged.qa.status === "PASS" && staged.contextComplete;
    return {
      ...base,
      ...summary,
      parserType: classification.type,
      status: passed ? "READY_TO_PUBLISH" : "REVIEW_REQUIRED",
      reason: passed
        ? "QA_PASS_AWAITING_PUBLISH"
        : staged.qa.status !== "PASS"
          ? `PARSER_${classification.type}_QA_FAILED`
          : "MISSING_PUBLICATION_CONTEXT",
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

    const parser = parserFor(classification.type);
    if (!parser) {
      return this.#blocked({
        reason: classification.type === "UNKNOWN" ? "UNKNOWN_PATTERN" : `PARSER_${classification.type}_NOT_ENABLED`,
        sourceSha256,
        sourceKey,
        metadata: meta,
        derivedPeriod,
        classification,
      });
    }

    let staged;
    try {
      staged = await parser.stage({
        workbook,
        queue: this.queue,
        sourceSha256,
        sourceKey,
        metadata: meta,
        period: derivedPeriod,
        classification,
      });
    } catch (error) {
      console.error(`KGMU ${classification.type} parser failed`, error);
      return this.#blocked({
        reason: `PARSER_${classification.type}_FAILED`,
        sourceSha256,
        sourceKey,
        metadata: meta,
        derivedPeriod,
        classification,
        parserError: {
          code: error?.code || `KGMU_${classification.type}_FAILED`,
          message: String(error?.message || error).slice(0, 500),
        },
      });
    }

    if (staged.qa.status !== "PASS" || !staged.contextComplete) {
      return this.#blocked({
        reason: staged.qa.status !== "PASS" ? `PARSER_${classification.type}_QA_FAILED` : "MISSING_PUBLICATION_CONTEXT",
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
      parserType: classification.type,
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
      const notification = await this.#notifyReady(review);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256,
        classification,
        derivedPeriod,
        qa: staged.qa,
        normalizedKey: staged.normalizedKey,
        notification,
        publicationBlocked: true,
      };
    }

    try {
      review = await this.#publishReady(review, parser.publish);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256,
        classification,
        derivedPeriod,
        qa: staged.qa,
        published: review.published,
        publicationBlocked: false,
      };
    } catch (error) {
      console.error("KGMU automatic publication failed", error);
      review = await this.queue.updateReview(review.reviewId, {
        status: "REVIEW_REQUIRED",
        reason: "PUBLICATION_FAILED",
        publicationBlocked: true,
        publicationError: String(error?.message || error),
      });
      const notification = await this.#notify(review);
      return {
        reviewId: review.reviewId,
        status: review.status,
        reason: review.reason,
        parserType: review.parserType,
        sourceSha256,
        classification,
        derivedPeriod,
        qa: staged.qa,
        notification,
        publicationBlocked: true,
      };
    }
  }

  async publishReview(reviewId) {
    const review = await this.queue.getReview(reviewId);
    if (!review) return null;
    if (review.status === "PUBLISHED") return review;
    if (review.status !== "READY_TO_PUBLISH") {
      const error = new Error("Parser review is not ready to publish");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    const parser = parserFor(review.parserType || review.classification?.type);
    if (!parser) {
      const error = new Error("Parser type is not publishable");
      error.code = "REVIEW_NOT_PUBLISHABLE";
      throw error;
    }
    return this.#publishReady(review, parser.publish);
  }
}
