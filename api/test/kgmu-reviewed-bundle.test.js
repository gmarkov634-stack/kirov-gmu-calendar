import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateReviewedBundle, stageReviewedBundle, publishStagedReviewedBundle } from "../src/adapters/kgmu/reviewed-bundle.mjs";
import { KgmuReviewedService } from "../src/adapters/kgmu/reviewed-service.mjs";

const sourceBytes = Buffer.from("official-xlsx-placeholder");
const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");

function bundle() {
  return {
    version: 1,
    university: "kgmu",
    program: "pediatrics",
    course: 2,
    academicYear: "2025/26",
    semester: 2,
    source: {
      filename: "2_ped.xlsx",
      sha256: sourceSha,
      url: "https://kirovgma.ru/upload/schedule/2_ped.xlsx",
      groupRange: "231-232",
    },
    normalizer: { type: "chatgpt-reviewed", rulesRevision: "R69" },
    groups: {
      "231": { events: [{ title: "Гигиена", start: "2026-02-02T10:30:00+03:00", end: "2026-02-02T12:55:00+03:00", location: "3 корпус" }] },
      "232": { events: [{ title: "Биохимия", start: "2026-02-03T13:00:00+03:00", end: "2026-02-03T16:10:00+03:00", location: "1 корпус" }] },
    },
  };
}

function sourceFetch(bytes = sourceBytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => bytes,
  });
}

test("reviewed JSON validator builds canonical KGMU schedules without parsing XLSX", () => {
  const result = validateReviewedBundle(bundle());
  assert.equal(result.qa.status, "PASS");
  assert.equal(result.qa.groupCount, 2);
  assert.equal(result.qa.eventCount, 2);
  assert.deepEqual(result.schedules.map((item) => item.group.code), ["231", "232"]);
  assert.equal(result.schedules[0].events[0].title, "Гигиена");
  assert.match(result.schedules[0].events[0].id, /^kgmu-231-2026-02-02-1030-/);
});

test("reviewed JSON validator requires the exact official group range", () => {
  const input = bundle();
  delete input.groups["232"];
  assert.throws(() => validateReviewedBundle(input), (error) => error.code === "REVIEWED_BUNDLE_GROUPS_INVALID");
});

test("reviewed JSON staging verifies the official source SHA", async () => {
  let stored = null;
  const queue = {
    storeNormalized: async (sha, value) => {
      stored = value;
      return `parser-staging/kgmu/normalized/${sha}.json`;
    },
  };
  const staged = await stageReviewedBundle({
    bundle: bundle(),
    queue,
    config: { kgmuReviewedVerifySource: true, kgmuXlsxMaxBytes: 1024 },
    fetchFn: sourceFetch(),
  });
  assert.equal(staged.qa.sourceVerified, true);
  assert.equal(stored.sourceSha256, sourceSha);

  await assert.rejects(
    stageReviewedBundle({
      bundle: bundle(),
      queue,
      config: { kgmuReviewedVerifySource: true, kgmuXlsxMaxBytes: 1024 },
      fetchFn: sourceFetch(Buffer.from("changed-official-file")),
    }),
    (error) => error.code === "REVIEWED_SOURCE_SHA_MISMATCH",
  );
});

test("reviewed JSON publishes one atomic schedule bundle", async () => {
  const normalized = validateReviewedBundle(bundle());
  normalized.parserType = "REVIEWED_JSON";
  normalized.sourceSha256 = sourceSha;
  normalized.qa.sourceVerified = true;
  let written = null;
  const result = await publishStagedReviewedBundle({
    queue: { getNormalized: async () => normalized },
    scheduleStore: {
      putScheduleBundle: async (schedules, options) => {
        written = { schedules, options };
        return { bundleKey: "bundle-reviewed", groupCount: schedules.length };
      },
    },
    review: {
      reviewId: "reviewed-1",
      parserType: "REVIEWED_JSON",
      normalizedKey: `parser-staging/kgmu/normalized/${sourceSha}.json`,
      sourceSha256: sourceSha,
      qa: { status: "PASS" },
    },
  });
  assert.equal(written.schedules.length, 2);
  assert.equal(written.options.sourceSha256, sourceSha);
  assert.ok(written.schedules.every((item) => item.parserReviewId === "reviewed-1"));
  assert.equal(result.groupCount, 2);
});

test("manual source observation stores XLSX but never parses it", async () => {
  let storedSource = null;
  let createdReview = null;
  const service = new KgmuReviewedService({
    queue: {
      storeSource: async (buffer, sha, filename) => {
        storedSource = { buffer, sha, filename };
        return `parser-staging/kgmu/sources/${sha}/${filename}`;
      },
      createReview: async (value) => {
        createdReview = { reviewId: "review-observe", status: "REVIEW_REQUIRED", ...value };
        return createdReview;
      },
    },
    notifier: { notifyReviewRequired: async () => ({ sent: true }) },
    config: {},
    scheduleStore: {},
  });
  const result = await service.observeSource(sourceBytes, {
    filename: "2_ped.xlsx",
    program: "pediatrics",
    course: 2,
    academicYear: "2025/26",
    semester: 2,
    groupRange: "231-238",
    sourceUrl: "https://kirovgma.ru/upload/schedule/2_ped.xlsx",
  });
  assert.equal(storedSource.sha, sourceSha);
  assert.equal(createdReview.reason, "MANUAL_NORMALIZATION_REQUIRED");
  assert.equal(createdReview.classification.reason, "server-xlsx-parsing-disabled");
  assert.equal(result.status, "REVIEW_REQUIRED");
});
