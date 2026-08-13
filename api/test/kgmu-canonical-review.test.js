import test from "node:test";
import assert from "node:assert/strict";
import {
  stageCanonicalReviewPackage,
  validateCanonicalReviewPackage,
} from "../src/adapters/kgmu/canonical-reviewed.mjs";
import { KgmuReviewedService } from "../src/adapters/kgmu/reviewed-service.mjs";

const SOURCE_SHA = "a".repeat(64);
const REVIEW_ID = "123e4567-e89b-12d3-a456-426614174000";

function event({ group = "401", fileName = "1_ped.xlsx", fileHash = null } = {}) {
  return {
    schema_version: "1.0",
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: {
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      faculty_name: "Педиатрический факультет",
      course: 4,
    },
    audience: { group, scope: "whole_group", subgroups: [], stream: null },
    timing: {
      date: "2026-09-01",
      start_time: "09:00",
      end_time: "10:30",
      all_day: false,
      time_mode: "floating",
    },
    lesson: {
      discipline: { raw: "ПЕДИАТРИЯ", normalized: "Педиатрия" },
      type: { raw: "практ.", code: "practice" },
      teachers: [],
      locations: [{ raw: "1 корпус, ауд. 305", building: "1 корпус", room: "305", address: null }],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: fileName,
      file_hash: fileHash,
      sheet: "4 курс",
      references: [{ role: "lesson", range: "D18" }],
      raw_text: "ПЕДИАТРИЯ практ.",
    },
    parse: { status: "ok", rule_ids: ["R69"], warnings: [] },
    derived: {
      academic_week: null,
      sequence: { index: null, total: null, bucket: null },
      next_same_event: null,
      is_last_same_event: false,
      day: {
        index: null,
        total: null,
        remaining: null,
        next_event: null,
        gap_minutes: null,
        overlaps_next: false,
      },
      cycle: null,
      assessment: null,
    },
    calendar: { title: null, description: null, location: null },
  };
}

function batch({ group = "401", course = 4, facultyCode = "pediatrics", fileName = "1_ped.xlsx", fileHash = null } = {}) {
  const item = event({ group, fileName, fileHash });
  item.academic.course = course;
  item.academic.faculty_code = facultyCode;
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: facultyCode,
      course,
      group,
      period: {
        start_date: "2026-09-01",
        end_date: "2026-12-28",
        week1_start_date: "2026-08-31",
      },
      source_files: [fileName],
      generated_at: null,
      parser: "chatgpt-rules",
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events: [item],
  };
}

function review(overrides = {}) {
  return {
    reviewId: REVIEW_ID,
    status: "REVIEW_REQUIRED",
    reason: "MANUAL_NORMALIZATION_REQUIRED",
    parserType: "REVIEWED_JSON",
    sourceSha256: SOURCE_SHA,
    sourceKey: `parser-staging/kgmu/sources/${SOURCE_SHA}/1_ped.xlsx`,
    metadata: {
      filename: "1_ped.xlsx",
      program: "pediatrics",
      course: 4,
      academicYear: "2026/27",
      semester: 1,
      groupRange: "401-401",
      sourceUrl: "https://kirovgma.ru/upload/schedule/1_ped.xlsx",
    },
    publicationBlocked: true,
    currentPublishedSchedulePreserved: true,
    ...overrides,
  };
}

function packageFor(batches = [batch()]) {
  return {
    format: "canonical-reviewed/v1",
    rules_revision: "R69+canonical-v1",
    batches,
  };
}

test("canonical review binds the exact observed XLSX SHA and passes schedule-batch QA", async () => {
  let stored = null;
  const staged = await stageCanonicalReviewPackage({
    input: packageFor(),
    review: review(),
    queue: {
      storeNormalized: async (sha, value) => {
        assert.equal(sha, SOURCE_SHA);
        stored = value;
        return `parser-staging/kgmu/normalized/${sha}.json`;
      },
    },
  });
  assert.equal(staged.qa.status, "PASS");
  assert.equal(staged.qa.groupCount, 1);
  assert.equal(staged.qa.eventCount, 1);
  assert.equal(stored.batches[0].events[0].source.file_hash, `sha256:${SOURCE_SHA}`);
  assert.equal(stored.qa.reports[0].publishable, true);
});

test("canonical review rejects source and publication-context mismatches", () => {
  assert.throws(
    () => validateCanonicalReviewPackage(packageFor([batch({ fileName: "other.xlsx" })]), review()),
    (error) => error.code === "CANONICAL_REVIEW_SOURCE_MISMATCH",
  );

  assert.throws(
    () => validateCanonicalReviewPackage(packageFor([batch({ fileHash: `sha256:${"b".repeat(64)}` })]), review()),
    (error) => error.code === "CANONICAL_REVIEW_SOURCE_MISMATCH",
  );

  assert.throws(
    () => validateCanonicalReviewPackage(packageFor([batch({ course: 5 })]), review()),
    (error) => error.code === "CANONICAL_REVIEW_CONTEXT_MISMATCH",
  );
});

test("canonical review requires exactly the groups declared by the source review", () => {
  const twoGroupReview = review({ metadata: { ...review().metadata, groupRange: "401-402" } });
  assert.throws(
    () => validateCanonicalReviewPackage(packageFor([batch({ group: "401" })]), twoGroupReview),
    (error) => error.code === "CANONICAL_REVIEW_GROUPS_INVALID" && error.details?.expected?.includes("402"),
  );
});

test("same parser review advances to READY_TO_PUBLISH and dashboard publish runs canonical pipeline", async () => {
  let currentReview = review();
  let normalized = null;
  let publishedBatch = null;
  const queue = {
    getReview: async (id) => id === REVIEW_ID ? structuredClone(currentReview) : null,
    storeNormalized: async (sha, value) => {
      normalized = structuredClone(value);
      return `parser-staging/kgmu/normalized/${sha}.json`;
    },
    getNormalized: async () => structuredClone(normalized),
    updateReview: async (id, patch) => {
      assert.equal(id, REVIEW_ID);
      currentReview = { ...currentReview, ...structuredClone(patch) };
      return structuredClone(currentReview);
    },
  };
  const service = new KgmuReviewedService({
    queue,
    notifier: { notifyReadyToPublish: async () => ({ sent: true }) },
    config: {},
    scheduleStore: {
      getSchedule: async () => null,
      putSchedule: async (value) => {
        publishedBatch = structuredClone(value);
        return { manifestKey: "current.json", unchanged: false };
      },
    },
  });

  const staged = await service.submitCanonical(REVIEW_ID, packageFor());
  assert.equal(staged.reviewId, REVIEW_ID);
  assert.equal(staged.status, "READY_TO_PUBLISH");
  assert.equal(staged.parserType, "REVIEWED_JSON");
  assert.equal(currentReview.normalizer.format, "canonical-reviewed/v1");
  assert.equal(currentReview.currentPublishedSchedulePreserved, true);

  const published = await service.publishReview(REVIEW_ID);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.reason, "CANONICAL_REVIEWED_JSON_PUBLISHED");
  assert.deepEqual(published.published.groups, ["401"]);
  assert.ok(publishedBatch.schedule.schedule_version_id.startsWith("ver_"));
  assert.ok(publishedBatch.events[0].system.event_id);
  assert.equal(publishedBatch.events[0].derived.academic_week, 1);
  assert.equal(publishedBatch.events[0].derived.sequence.index, 1);
  assert.equal(publishedBatch.events[0].derived.sequence.total, 1);
  assert.ok(publishedBatch.events[0].calendar.title);
  assert.equal(publishedBatch.events[0].source.file_hash, `sha256:${SOURCE_SHA}`);
});
