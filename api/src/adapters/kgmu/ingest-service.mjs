import { createHash } from "node:crypto";
import { classifyKgmuWorkbook } from "./classifier.mjs";
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
  constructor({ queue, notifier, config }) {
    this.queue = queue;
    this.notifier = notifier;
    this.config = config;
  }

  async ingest(buffer, metadata = {}) {
    const sourceSha256 = sha256(buffer);
    const normalized = normalizeMetadata(metadata);
    const sourceKey = await this.queue.storeSource(buffer, sourceSha256, normalized.filename);
    const workbook = await readKgmuXlsxStructure(buffer, {
      maxBytes: Number(this.config.kgmuXlsxMaxBytes || 25 * 1024 * 1024),
    });
    const classification = classifyKgmuWorkbook(workbook);

    // Parsing is deliberately fail-closed until each R/C/S implementation is ported
    // from the approved rule specifications and regression-tested against source XLSX.
    const reason = classification.type === "UNKNOWN"
      ? "UNKNOWN_PATTERN"
      : `PARSER_${classification.type}_NOT_ENABLED`;

    const review = await this.queue.createReview({
      reason,
      sourceSha256,
      sourceKey,
      metadata: normalized,
      classification,
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
      reason,
      sourceSha256,
      classification,
      notification,
      publicationBlocked: true,
    };
  }
}
