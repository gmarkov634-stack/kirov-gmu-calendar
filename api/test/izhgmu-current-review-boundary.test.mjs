import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { IzhgmuReviewQueue } from "../src/adapters/izhgmu/review-queue.mjs";
import { IzhgmuReviewedService } from "../src/adapters/izhgmu/reviewed-service.mjs";
import { validateIzhgmuCanonicalReviewPackage } from "../src/adapters/izhgmu/canonical-reviewed.mjs";
import { ScheduleReviewServiceRouter } from "../src/schedule/review-service-router.js";

const SOURCE_FILE = "medicine1-classes.xlsx";
const SOURCE_URL = "https://www.igma.ru/schedule/medicine1-classes.xlsx";
const SOURCE_SHA = "a".repeat(64);
const SOURCE_SET_DIGEST = createHash("sha256").update(`${SOURCE_URL}\0${SOURCE_SHA}`).digest("hex");

function reviewInput() {
  return {
    university: "izhgmu",
    program: "medicine",
    courses: [1, 2, 3],
    academicYear: "2026/2027",
    semester: "autumn",
    sourceSet: { digest: SOURCE_SET_DIGEST, members: [{ url: SOURCE_URL, filename: SOURCE_FILE, sha256: SOURCE_SHA }] },
  };
}

async function exampleBatch() {
  const filename = path.resolve(import.meta.dirname, "../../examples/schedule-batch.example.json");
  const batch = JSON.parse(await fs.readFile(filename, "utf8"));
  batch.schedule.university_code = "izhgmu";
  batch.schedule.faculty_code = "medicine";
  batch.schedule.course = 1;
  batch.schedule.group = "101";
  batch.schedule.source_files = [SOURCE_FILE];
  batch.schedule.parser = "chatgpt-izhgmu-reviewed";
  for (const event of batch.events) {
    event.university = { code: "izhgmu", name: "Ижевский ГМУ" };
    event.academic.faculty_code = "medicine";
    event.academic.faculty_name = "Лечебный факультет";
    event.academic.course = 1;
    event.audience.group = "101";
    event.source.file_name = SOURCE_FILE;
    event.source.file_hash = `sha256:${SOURCE_SHA}`;
  }
  return batch;
}

test("source-set review creation is idempotent and digest-bound", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "izh-review-"));
  const queue = new IzhgmuReviewQueue({ dataDir });
  const service = new IzhgmuReviewedService({ queue, scheduleStore: {} });
  const first = await service.createReview(reviewInput());
  const second = await service.createReview(reviewInput());
  assert.equal(first.reviewId, second.reviewId);
  assert.equal(first.status, "REVIEW_REQUIRED");
  assert.equal(first.publicationBlocked, true);
  await assert.rejects(() => service.createReview({ ...reviewInput(), sourceSet: { ...reviewInput().sourceSet, digest: "b".repeat(64) } }), (error) => error.code === "IZHGMU_SOURCE_SET_INVALID");
});

test("canonical review accepts exact source set and rejects SHA drift", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "izh-review-"));
  const queue = new IzhgmuReviewQueue({ dataDir });
  const service = new IzhgmuReviewedService({ queue, scheduleStore: {} });
  const review = await service.createReview(reviewInput());
  const batch = await exampleBatch();
  const input = { format: "canonical-reviewed/v1", source_set_digest: SOURCE_SET_DIGEST, rules_revision: "izhgmu-2026-08-17", batches: [batch] };
  const normalized = validateIzhgmuCanonicalReviewPackage(input, review);
  assert.equal(normalized.qa.status, "PASS");
  assert.equal(normalized.qa.groupCount, 1);
  assert.equal(normalized.qa.sourceBoundEventCount, 1);

  const drift = structuredClone(input);
  drift.batches[0].events[0].source.file_hash = `sha256:${"b".repeat(64)}`;
  assert.throws(() => validateIzhgmuCanonicalReviewPackage(drift, review), (error) => error.code === "IZHGMU_CANONICAL_SOURCE_MISMATCH");
});

test("current boundary rejects historical or deferred course publication", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "izh-review-"));
  const queue = new IzhgmuReviewQueue({ dataDir });
  const service = new IzhgmuReviewedService({ queue, scheduleStore: {} });
  const review = await service.createReview(reviewInput());
  const batch = await exampleBatch();
  const input = { format: "canonical-reviewed/v1", source_set_digest: SOURCE_SET_DIGEST, rules_revision: "izhgmu-2026-08-17", batches: [batch] };

  const historical = structuredClone(input);
  historical.batches[0].schedule.academic_year = "2025/2026";
  historical.batches[0].events[0].academic.academic_year = "2025/2026";
  assert.throws(() => validateIzhgmuCanonicalReviewPackage(historical, review), (error) => ["IZHGMU_CANONICAL_CONTEXT_MISMATCH", "IZHGMU_CURRENT_PERIOD_REQUIRED"].includes(error.code));

  const deferred = structuredClone(input);
  deferred.batches[0].schedule.course = 4;
  deferred.batches[0].events[0].academic.course = 4;
  assert.throws(() => validateIzhgmuCanonicalReviewPackage(deferred, review), (error) => error.code === "IZHGMU_CANONICAL_CONTEXT_MISMATCH");
});

test("shared review router can create only through the IzhGMU service", async () => {
  const calls = [];
  const izh = { university: "izhgmu", createReview: async (input) => { calls.push(input); return { reviewId: "x", university: "izhgmu" }; }, queue: { getReview: async () => null } };
  const other = { queue: { getReview: async () => null } };
  const router = new ScheduleReviewServiceRouter([other, izh]);
  assert.equal((await router.createReview({ university: "izhgmu" })).university, "izhgmu");
  assert.equal(calls.length, 1);
  assert.equal(await router.createReview({ university: "unknown" }), null);
});
