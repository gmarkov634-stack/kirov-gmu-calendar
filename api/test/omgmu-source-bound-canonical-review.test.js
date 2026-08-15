import assert from "node:assert/strict";
import test from "node:test";
import { buildOmgmuCanonicalBatch } from "../src/adapters/omgmu/canonical.mjs";
import { OmgmuReviewedService } from "../src/adapters/omgmu/reviewed-service.mjs";
import { ScheduleReviewServiceRouter } from "../src/schedule/review-service-router.js";

const SHA = "a".repeat(64);

function batch({ hash = `sha256:${SHA}` } = {}) {
  return buildOmgmuCanonicalBatch({
    metadata: {
      academicYear: "2026/2027",
      semester: 1,
      program: "medicine",
      facultyName: "Лечебное дело",
      course: 1,
      group: "101",
      period: { start_date: "2026-09-01", end_date: "2026-12-31", week1_start_date: "2026-09-01" },
      parser: "chatgpt-omgmu-reviewed",
    },
    source: { fileName: "01_medicine_course1.pdf", fileHash: hash },
    series: [{
      discipline: "Анатомия",
      disciplineNormalized: "Анатомия",
      kind: "lecture",
      startTime: "08:20",
      endTime: "10:00",
      dates: ["2026-09-01"],
      rawSource: "Анатомия 08:20-10:00",
      references: [{ role: "pdf_geometry", range: "page=2,row=1" }],
      ruleIds: ["O16"],
      status: "ok",
    }],
  });
}

class MemoryQueue {
  constructor(review) { this.review = structuredClone(review); this.normalized = null; }
  async getReview(id) { return id === this.review.reviewId ? structuredClone(this.review) : null; }
  async updateReview(id, patch) { if (id !== this.review.reviewId) return null; this.review = { ...this.review, ...structuredClone(patch) }; return structuredClone(this.review); }
  async storeNormalized(sha, value) { assert.equal(sha, SHA); this.normalized = structuredClone(value); return `parser-staging/omgmu/normalized/${sha}.json`; }
  async getNormalized(key) { return key ? structuredClone(this.normalized) : null; }
}

function fixture() {
  const review = {
    version: 1,
    reviewId: "00000000-0000-0000-0000-000000000105",
    university: "omgmu",
    status: "REVIEW_REQUIRED",
    reason: "SOURCE_REVISION_REQUIRES_CHATGPT_REVIEW",
    parserType: "CHATGPT_REVIEWED_PDF",
    sourceSha256: SHA,
    metadata: {
      filename: "01_medicine_course1.pdf",
      program: "medicine",
      course: 1,
      academicYear: "2026/27",
      semester: 1,
    },
    publicationBlocked: true,
    currentPublishedSchedulePreserved: true,
  };
  const queue = new MemoryQueue(review);
  const writes = [];
  const scheduleStore = {
    async getSchedule() { return null; },
    async putSchedule(value) { writes.push(structuredClone(value)); return { unchanged: false, currentKey: "current.json" }; },
  };
  const service = new OmgmuReviewedService({ queue, scheduleStore });
  return { queue, writes, service };
}

test("ChatGPT canonical submit moves source-bound ОмГМУ review to READY but does not publish", async () => {
  const { queue, writes, service } = fixture();
  const ready = await service.submitCanonical(queue.review.reviewId, {
    format: "canonical-reviewed/v1",
    rules_revision: "omgmu-o-rules-2026-08-15",
    batches: [batch()],
  });
  assert.equal(ready.status, "READY_TO_PUBLISH");
  assert.equal(ready.qa.status, "PASS");
  assert.equal(ready.qa.groupCount, 1);
  assert.equal(ready.qa.reviewedSourceEventCount, 1);
  assert.equal(ready.publicationBlocked, true);
  assert.equal(writes.length, 0);
  assert.equal(queue.normalized.batches[0].events[0].source.file_hash, `sha256:${SHA}`);
});

test("explicit publish of READY ОмГМУ review uses common pipeline before moving current", async () => {
  const { queue, writes, service } = fixture();
  await service.submitCanonical(queue.review.reviewId, {
    format: "canonical-reviewed/v1",
    rules_revision: "omgmu-o-rules-2026-08-15",
    batches: [batch()],
  });
  const published = await service.publishReview(queue.review.reviewId);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.publicationBlocked, false);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].schedule.schedule_version_id);
  assert.ok(writes[0].events[0].system.event_id);
  assert.equal(writes[0].events[0].timing.time_mode, "floating");
});

test("reviewed PDF SHA mismatch is fail-closed before any schedule write", async () => {
  const { queue, writes, service } = fixture();
  await assert.rejects(
    service.submitCanonical(queue.review.reviewId, {
      format: "canonical-reviewed/v1",
      rules_revision: "omgmu-o-rules-2026-08-15",
      batches: [batch({ hash: `sha256:${"b".repeat(64)}` })],
    }),
    (error) => error?.code === "CANONICAL_REVIEW_SOURCE_MISMATCH",
  );
  assert.equal(queue.review.status, "REVIEW_REQUIRED");
  assert.equal(writes.length, 0);
});

test("canonical batch that omits the reviewed PDF cannot be used to approve its review", async () => {
  const { queue, writes, service } = fixture();
  const value = batch();
  value.schedule.source_files = ["other.pdf"];
  value.events[0].source.file_name = "other.pdf";
  value.events[0].source.file_hash = `sha256:${"c".repeat(64)}`;
  await assert.rejects(
    service.submitCanonical(queue.review.reviewId, { format: "canonical-reviewed/v1", rules_revision: "rules", batches: [value] }),
    (error) => error?.code === "CANONICAL_REVIEW_SOURCE_MISMATCH",
  );
  assert.equal(writes.length, 0);
});

test("shared review control router preserves KGMU service and routes ОмГМУ review IDs separately", async () => {
  const calls = [];
  function service(name, id) {
    return {
      queue: { async getReview(value) { return value === id ? { reviewId: id } : null; } },
      async submitCanonical(value) { calls.push(`${name}:submit:${value}`); return { reviewId: value, status: "READY_TO_PUBLISH" }; },
      async publishReview(value) { calls.push(`${name}:publish:${value}`); return { reviewId: value, status: "PUBLISHED" }; },
    };
  }
  const kgId = "00000000-0000-0000-0000-000000000001";
  const omId = "00000000-0000-0000-0000-000000000002";
  const router = new ScheduleReviewServiceRouter([service("kgmu", kgId), service("omgmu", omId)]);
  await router.submitCanonical(kgId, {}, {});
  await router.publishReview(omId);
  assert.deepEqual(calls, [`kgmu:submit:${kgId}`, `omgmu:publish:${omId}`]);
  assert.equal(await router.publishReview("00000000-0000-0000-0000-000000000099"), null);
});
