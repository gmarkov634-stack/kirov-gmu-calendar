import test from "node:test";
import assert from "node:assert/strict";
import { KgmuSourceWatcher } from "../src/adapters/kgmu/source-watcher.mjs";
import { createKgmuWatchStatusHandler } from "../src/kgmu-watch-status.js";

function responseCapture() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("watcher persists a safe summary even when the target offer is not published yet", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const oldHtml = `<a href="/files/old.xlsx">101-110 (второе полугодие 2025-2026 уч. г.)</a>`;
  const fetchFn = async (url) => {
    if (Object.values(pages).includes(url)) return new Response(oldHtml, { status: 200 });
    throw new Error(`unexpected url ${url}`);
  };
  let state = {
    version: 1,
    university: "kgmu",
    slots: {
      legacy: { url: "https://private.invalid/secret.xlsx", sha256: "abc" },
    },
  };
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  const watcher = new KgmuSourceWatcher({
    config: {
      offerAcademicYear: "2026/27",
      offerSemester: 1,
      kgmuWatchSemesters: [1, 2],
      kgmuParserRevision: "test-revision",
      kgmuMedicineSchedulePage: pages.medicine,
      kgmuPediatricsSchedulePage: pages.pediatrics,
      kgmuDentistrySchedulePage: pages.dentistry,
      kgmuForeignSchedulePage: pages.foreign,
    },
    ingestService: { ingest: async () => { throw new Error("must not ingest"); } },
    stateStore,
    fetchFn,
  });

  const result = await watcher.run();
  assert.equal(result.status, "OK");
  assert.equal(result.discoveredCount, 4);
  assert.equal(result.targetCount, 0);
  assert.equal(result.ingestedCount, 0);
  assert.equal(result.errorCount, 0);
  assert.equal(state.lastRunAt, result.checkedAt);
  assert.deepEqual(state.lastRunSummary, {
    status: "OK",
    checkedAt: result.checkedAt,
    expectedAcademicYear: "2026/27",
    expectedSemesters: [1, 2],
    parserRevision: "test-revision",
    discoveredCount: 4,
    targetCount: 0,
    ingestedCount: 0,
    unchangedCount: 0,
    notificationRetryCount: 0,
    pendingNotificationCount: 0,
    errorCount: 0,
  });
});

test("public watcher status exposes only aggregate health data", async () => {
  const stateStore = {
    read: async () => ({
      lastRunAt: "2026-08-12T16:30:00.000Z",
      lastRunSummary: {
        status: "OK",
        checkedAt: "2026-08-12T16:30:00.000Z",
        expectedAcademicYear: "2026/27",
        expectedSemesters: [1, 2],
        parserRevision: "test-revision",
        discoveredCount: 20,
        targetCount: 1,
        ingestedCount: 1,
        unchangedCount: 0,
        notificationRetryCount: 1,
        pendingNotificationCount: 1,
        errorCount: 0,
      },
      slots: {
        secret: {
          url: "https://private.invalid/secret.xlsx",
          sha256: "top-secret-hash",
          reviewId: "private-review-id",
        },
      },
    }),
  };
  const handler = createKgmuWatchStatusHandler({
    stateStore,
    config: { kgmuWatchEnabled: true, kgmuWatchIntervalMs: 900000 },
  });
  const response = responseCapture();
  await handler({ method: "GET" }, response);

  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  const body = JSON.parse(response.body);
  assert.equal(body.university, "kgmu");
  assert.equal(body.enabled, true);
  assert.equal(body.intervalMs, 900000);
  assert.equal(body.lastRun.targetCount, 1);
  assert.equal(body.lastRun.notificationRetryCount, 1);
  assert.equal(body.lastRun.pendingNotificationCount, 1);
  assert.equal(body.lastRun.errorCount, 0);
  assert.equal("slots" in body, false);
  assert.equal(JSON.stringify(body).includes("secret.xlsx"), false);
  assert.equal(JSON.stringify(body).includes("top-secret-hash"), false);
  assert.equal(JSON.stringify(body).includes("private-review-id"), false);
});
