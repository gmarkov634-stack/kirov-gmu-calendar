import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { KgmuReviewedService } from "../src/adapters/kgmu/reviewed-service.mjs";

const sourceBytes = Buffer.from("cached-official-xlsx");
const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");

function reviewedBundle() {
  return {
    version: 1,
    university: "kgmu",
    program: "medicine",
    course: 4,
    academicYear: "2025/26",
    semester: 2,
    source: {
      filename: "4_kurs.xlsx",
      sha256: sourceSha,
      url: "https://kirovgma.ru/upload/schedule/4_kurs.xlsx",
      groupRange: "401-401",
    },
    normalizer: { type: "chatgpt-reviewed", rulesRevision: "C13" },
    groups: {
      "401": {
        events: [{
          title: "Факультетская терапия",
          start: "2026-02-02T09:00:00+03:00",
          end: "2026-02-02T10:30:00+03:00",
          location: "1 корпус",
          kind: "practice",
        }],
      },
    },
  };
}

function serviceWithCachedSource(bytes) {
  let requestedKey = null;
  let createdReview = null;
  let networkCalls = 0;
  const service = new KgmuReviewedService({
    queue: {
      getSource: async (key) => {
        requestedKey = key;
        return bytes;
      },
      storeNormalized: async (sha) => `parser-staging/kgmu/normalized/${sha}.json`,
      createReview: async (value) => {
        createdReview = { reviewId: "cached-review", status: value.status, ...value };
        return createdReview;
      },
    },
    notifier: { notifyReadyToPublish: async () => ({ sent: true }) },
    config: { kgmuReviewedVerifySource: true, kgmuXlsxMaxBytes: 1024 },
    scheduleStore: {},
    fetchFn: async () => {
      networkCalls += 1;
      throw new Error("official network must not be used when staged source exists");
    },
  });
  return {
    service,
    state: () => ({ requestedKey, createdReview, networkCalls }),
  };
}

test("reviewed bundle verifies matching staged XLSX without refetching the official URL", async () => {
  const { service, state } = serviceWithCachedSource(sourceBytes);
  const result = await service.submit(reviewedBundle(), { publish: false });
  assert.equal(result.status, "READY_TO_PUBLISH");
  const snapshot = state();
  assert.equal(snapshot.networkCalls, 0);
  assert.equal(
    snapshot.requestedKey,
    `parser-staging/kgmu/sources/${sourceSha}/4_kurs.xlsx`,
  );
  assert.equal(snapshot.createdReview.sourceVerification.verified, true);
  assert.equal(snapshot.createdReview.sourceVerification.sha256, sourceSha);
  assert.equal(snapshot.createdReview.sourceVerification.bytes, sourceBytes.length);
});

test("corrupt staged XLSX still fails closed on SHA mismatch", async () => {
  const { service, state } = serviceWithCachedSource(Buffer.from("different-bytes"));
  await assert.rejects(
    service.submit(reviewedBundle(), { publish: false }),
    (error) => error.code === "REVIEWED_SOURCE_SHA_MISMATCH",
  );
  assert.equal(state().networkCalls, 0);
});
