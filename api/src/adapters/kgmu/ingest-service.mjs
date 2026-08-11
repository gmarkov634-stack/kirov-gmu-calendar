import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "./classifier.mjs";
import { parseKgmuCycleWorkbook } from "./cycle-parser.mjs";
import { readKgmuXlsxStructure } from "./xlsx-reader.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeMetadata(metadata = {}) {
  const semester = Number(metadata.semester);
  const course = Number(metadata.course);
  return {
    filename: String(metadata.filename || "schedule.xlsx").slice(0, 200),
    program: metadata.program ? String(metadata.program).slice(0, 80) : null,
    course: Number.isInteger(course) && course > 0 ? course : null,
    academicYear: metadata.academicYear ? String(metadata.academicYear).slice(0, 20) : null,
    semester: [1, 2].includes(semester) ? semester : null,
  };
}

export class KgmuIngestService {
  constructor({ queue, notifier, config, store }) {
    this.queue = queue;
    this.notifier = notifier;
    this.config = config;
    this.store = store;
  }

  async ingest(buffer, metadata = {}) {
    const sourceSha256 = sha256(buffer);
    const normalized = normalizeMetadata(metadata);
    const sourceKey = await this.queue.storeSource(buffer, sourceSha256, normalized.filename);
    const workbook = await readKgmuXlsxStructure(buffer, {
      maxBytes: Number(this.config.kgmuXlsxMaxBytes || 25 * 1024 * 1024),
    });
    const classification = classifyKgmuWorkbook(workbook);

    if (classification.type === "C") {
      try {
        const parsed = parseKgmuCycleWorkbook(workbook, {
          ...normalized,
          sourceSha256,
          sourceKey,
        });
        if (parsed.qa.passed) {
          const provenance = {
            type: "xlsx",
            fileName: normalized.filename,
            sha256: sourceSha256,
            storageKey: sourceKey,
          };
          const schedules = parsed.schedules.map((schedule) => ({
            ...schedule,
            sources: [provenance],
          }));
          const publication = await this.store.putScheduleBundle(schedules, { sourceSha256 });
          return {
            status: "PUBLISHED",
            parserType: "C",
            sourceSha256,
            classification,
            qa: parsed.qa,
            publication,
            publicationBlocked: false,
          };
        }
        return this.#review({
          reason: "PARSER_C_QA_FAILED",
          sourceSha256,
          sourceKey,
          metadata: normalized,
          classification,
          qa: parsed.qa,
        });
      } catch (error) {
        console.error("KGMU C parser failed", error);
        return this.#review({
          reason: "PARSER_C_FAILED",
          sourceSha256,
          sourceKey,
          metadata: normalized,
          classification,
          parserError: {
            code: error.code || "KGMU_C_FAILED",
            message: String(error.message || error).slice(0, 500),
          },
        });
      }
    }

    return this.#review({
      reason: classification.type === "UNKNOWN" ? "UNKNOWN_PATTERN" : `PARSER_${classification.type}_NOT_ENABLED`,
      sourceSha256,
      sourceKey,
      metadata: normalized,
      classification,
    });
  }

  async #review(details) {
    const review = await this.queue.createReview({
      ...details,
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
    });

    let notification = { sent: false, reason: "not_attempted" };
    try {
      notification = await this.notifier.notifyReviewRequired(review);
    } catch (error) {
      console.error("parser review notification failed", error);
      notification = { sent: false, reason: error.code || "notification_failed" };
    }

    return {
      reviewId: review.reviewId,
      status: review.status,
      reason: review.reason,
      sourceSha256: review.sourceSha256,
      classification: review.classification,
      qa: review.qa || undefined,
      notification,
      publicationBlocked: true,
    };
  }
}
