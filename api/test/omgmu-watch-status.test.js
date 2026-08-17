import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createOmgmuWatchStatusHandler } from "../src/omgmu-watch-status.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const config = {
  omgmuWatchEnabled: false,
  omgmuWatchIntervalMs: 3600000,
  offerAcademicYear: "2026/27",
  offerSemester: 1,
};

test("OmGMU watcher status reports WAITING_SOURCE before current-period target appears", async () => {
  const handler = createOmgmuWatchStatusHandler({
    config,
    stateStore: {
      async read() {
        return {
          lastRunAt: "2026-08-17T14:00:00.000Z",
          lastRunSummary: {
            status: "OK",
            checkedAt: "2026-08-17T14:00:00.000Z",
            expectedAcademicYear: "2026/27",
            expectedSemester: 1,
            observedAcademicYear: "2025/26",
            observedSemester: 2,
            discoveredCount: 16,
            targetCount: 0,
            errorCount: 0,
            publicationAction: "none",
          },
        };
      },
    },
    reviewQueue: { async listReviews() { return []; } },
  });

  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/status/omgmu-watcher`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.university, "omgmu");
    assert.equal(body.enabled, false);
    assert.equal(body.expectedAcademicYear, "2026/27");
    assert.equal(body.expectedSemester, 1);
    assert.equal(body.sourceState, "WAITING_SOURCE");
    assert.equal(body.lastRun.targetCount, 0);
    assert.equal(body.publicationMode, "explicit-only");
  });
});

test("OmGMU watcher status exposes current-period REVIEW_REQUIRED without leaking review contents", async () => {
  const handler = createOmgmuWatchStatusHandler({
    config,
    stateStore: {
      async read() {
        return {
          lastRunAt: "2026-08-17T14:10:00.000Z",
          lastRunSummary: {
            status: "OK",
            checkedAt: "2026-08-17T14:10:00.000Z",
            expectedAcademicYear: "2026/27",
            expectedSemester: 1,
            observedAcademicYear: "2026/27",
            observedSemester: 1,
            discoveredCount: 4,
            targetCount: 2,
            newReviewCount: 1,
            changedReviewCount: 0,
            publicationAction: "review-required",
          },
        };
      },
    },
    reviewQueue: {
      async listReviews() {
        return [
          { status: "REVIEW_REQUIRED", metadata: { academicYear: "2026/27", semester: 1, filename: "current.pdf" } },
          { status: "REVIEW_REQUIRED", metadata: { academicYear: "2025/26", semester: 2, filename: "historical.pdf" } },
          { status: "PUBLISHED", metadata: { academicYear: "2026/27", semester: 1, filename: "published.pdf" } },
        ];
      },
    },
  });

  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/status/omgmu-watcher`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sourceState, "REVIEW_REQUIRED");
    assert.deepEqual(body.reviews, { reviewRequired: 1, readyToPublish: 0, published: 1 });
    assert.equal(JSON.stringify(body).includes("current.pdf"), false);
    assert.equal(body.lastRun.publicationAction, "review-required");
  });
});

test("OmGMU watcher status is read-only", async () => {
  const handler = createOmgmuWatchStatusHandler({
    config,
    stateStore: { async read() { return {}; } },
    reviewQueue: { async listReviews() { return []; } },
  });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/status/omgmu-watcher`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });
});
