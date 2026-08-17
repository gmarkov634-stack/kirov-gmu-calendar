import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { IzhgmuReviewQueue } from "../src/adapters/izhgmu/review-queue.mjs";
import { IzhgmuReviewedService } from "../src/adapters/izhgmu/reviewed-service.mjs";

const SOURCE_FILE = "medicine1-classes.xlsx";
const SOURCE_URL = "https://www.igma.ru/schedule/medicine1-classes.xlsx";
const SOURCE_SHA = "a".repeat(64);
const SOURCE_SET_DIGEST = createHash("sha256").update(`${SOURCE_URL}\0${SOURCE_SHA}`).digest("hex");

async function batch() {
  const filename = path.resolve(import.meta.dirname, "../../examples/schedule-batch.example.json");
  const value = JSON.parse(await fs.readFile(filename, "utf8"));
  value.schedule.university_code = "izhgmu";
  value.schedule.academic_year = "2026/2027";
  value.schedule.semester = "autumn";
  value.schedule.faculty_code = "medicine";
  value.schedule.course = 1;
  value.schedule.group = "101";
  value.schedule.source_files = [SOURCE_FILE];
  value.schedule.parser = "chatgpt-izhgmu-reviewed";
  for (const event of value.events) {
    event.university = { code: "izhgmu", name: "Ижевский ГМУ" };
    event.academic.academic_year = "2026/2027";
    event.academic.semester = "autumn";
    event.academic.faculty_code = "medicine";
    event.academic.faculty_name = "Лечебный факультет";
    event.academic.course = 1;
    event.audience.group = "101";
    event.source.file_name = SOURCE_FILE;
    event.source.file_hash = `sha256:${SOURCE_SHA}`;
  }
  return value;
}

function reviewInput() {
  return {
    university: "izhgmu",
    program: "medicine",
    courses: [1, 2, 3],
    academicYear: "2026/2027",
    semester: "autumn",
    sourceSet: {
      digest: SOURCE_SET_DIGEST,
      members: [{ url: SOURCE_URL, filename: SOURCE_FILE, sha256: SOURCE_SHA }],
    },
  };
}

test("READY IzhGMU review preserves last-known-good until explicit publish", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "izh-publish-"));
  const queue = new IzhgmuReviewQueue({ dataDir });
  const previous = await batch();
  previous.events[0].lesson.discipline.raw = "СТАРОЕ ЗАНЯТИЕ";
  previous.events[0].lesson.discipline.normalized = "Старое занятие";
  let current = structuredClone(previous);
  const writes = [];
  const scheduleStore = {
    async getSchedule() { return structuredClone(current); },
    async putSchedule(value) {
      current = structuredClone(value);
      writes.push(structuredClone(value));
      return { unchanged: false, currentKey: "current.json" };
    },
  };
  const service = new IzhgmuReviewedService({ queue, scheduleStore });
  const review = await service.createReview(reviewInput());
  const next = await batch();
  const ready = await service.submitCanonical(review.reviewId, {
    format: "canonical-reviewed/v1",
    source_set_digest: SOURCE_SET_DIGEST,
    rules_revision: "izhgmu-current-v1",
    batches: [next],
  });

  assert.equal(ready.status, "READY_TO_PUBLISH");
  assert.equal(ready.publicationBlocked, true);
  assert.equal(ready.currentPublishedSchedulePreserved, true);
  assert.equal(writes.length, 0);
  assert.equal(current.events[0].lesson.discipline.normalized, "Старое занятие");

  const published = await service.publishReview(review.reviewId);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.publicationBlocked, false);
  assert.equal(writes.length, 1);
  assert.equal(current.events[0].lesson.discipline.normalized, "Педиатрия");
  assert.ok(current.schedule.schedule_version_id);
  assert.equal(current.schedule.previous_schedule_version_id, previous.schedule.schedule_version_id);
});
