import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { OmgmuSourceObserver } from "../src/adapters/omgmu/source-observer.mjs";
import { OmgmuSourceWatcher } from "../src/adapters/omgmu/source-watcher.mjs";

function response(body, { status = 200, contentType = "text/html" } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return String(name).toLowerCase() === "content-length" ? String(bytes.length) : contentType; } },
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes,
  };
}

function page(pdfUrl = "https://omsk-osma.ru/files/1lech.pdf") {
  return `
    <h2>Расписание учебных занятий 2026/2027 учебный год, осенний семестр</h2>
    ${pdfUrl ? `<a href="${pdfUrl}">1 курс леч 1 поток</a>` : ""}
  `;
}

class MemoryStateStore {
  constructor() { this.state = { version: 1, university: "omgmu", slots: {} }; }
  async read() { return structuredClone(this.state); }
  async write(value) { this.state = structuredClone(value); return this.state; }
}

class RecordingObserver {
  constructor() { this.calls = []; }
  async observeSource(buffer, metadata) {
    this.calls.push({ bytes: Buffer.from(buffer), metadata });
    return {
      reviewId: `review-${this.calls.length}`,
      status: "REVIEW_REQUIRED",
      publicationBlocked: true,
    };
  }
}

function watcherFixture({ pageHtml = page(), pdf = Buffer.from("%PDF-1.7\nrevision-a"), pdfStatus = 200, stateStore = new MemoryStateStore(), observer = new RecordingObserver() } = {}) {
  const sourcePage = "https://omsk-osma.ru/studentam/raspisanie-zanyatiy";
  const pdfUrl = "https://omsk-osma.ru/files/1lech.pdf";
  const fetchFn = async (url) => {
    if (url === sourcePage) return response(pageHtml);
    if (url === pdfUrl) return response(pdf, { status: pdfStatus, contentType: "application/pdf" });
    return response("not found", { status: 404 });
  };
  const config = {
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    omgmuSchedulePage: sourcePage,
    omgmuWatchPrograms: ["medicine"],
    omgmuPdfMaxBytes: 1024 * 1024,
  };
  return { watcher: new OmgmuSourceWatcher({ config, observer, stateStore, fetchFn }), stateStore, observer, sourcePage, pdfUrl };
}

test("first matching ОмГМУ PDF creates review-required observation without publication", async () => {
  const fixture = watcherFixture();
  const result = await fixture.watcher.run();
  assert.equal(result.status, "OK");
  assert.equal(result.newReviewCount, 1);
  assert.equal(result.changedReviewCount, 0);
  assert.equal(result.publicationAction, "review-required");
  assert.equal(fixture.observer.calls.length, 1);
  assert.equal(fixture.observer.calls[0].metadata.academicYear, "2026/27");
  assert.equal(fixture.observer.calls[0].metadata.semester, 1);
  assert.equal(Object.values(fixture.stateStore.state.slots)[0].reviewStatus, "REVIEW_REQUIRED");
});

test("identical URL and SHA stays unchanged and creates no duplicate review", async () => {
  const fixture = watcherFixture();
  await fixture.watcher.run();
  const result = await fixture.watcher.run();
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.newReviewCount, 0);
  assert.equal(result.changedReviewCount, 0);
  assert.equal(result.publicationAction, "none");
  assert.equal(fixture.observer.calls.length, 1);
});

test("same source slot with changed PDF SHA creates a new review candidate", async () => {
  const fixture = watcherFixture();
  await fixture.watcher.run();
  const secondPdf = Buffer.from("%PDF-1.7\nrevision-b");
  fixture.watcher.fetch = async (url) => url === fixture.sourcePage ? response(page()) : response(secondPdf, { contentType: "application/pdf" });
  const result = await fixture.watcher.run();
  assert.equal(result.changedReviewCount, 1);
  assert.equal(fixture.observer.calls.length, 2);
  assert.notEqual(fixture.stateStore.state.slots["medicine:1:1:combined"].reviewId, "review-1");
});

test("missing source is diagnostic-only and preserves last observed SHA and review", async () => {
  const fixture = watcherFixture();
  await fixture.watcher.run();
  const previous = structuredClone(fixture.stateStore.state.slots["medicine:1:1:combined"]);
  fixture.watcher.fetch = async (url) => url === fixture.sourcePage ? response(page("")) : response("missing", { status: 404 });
  const result = await fixture.watcher.run();
  assert.equal(result.missingCount, 1);
  assert.equal(result.publicationAction, "none");
  assert.equal(fixture.observer.calls.length, 1);
  assert.equal(fixture.stateStore.state.slots["medicine:1:1:combined"].sha256, previous.sha256);
  assert.equal(fixture.stateStore.state.slots["medicine:1:1:combined"].reviewId, previous.reviewId);
});

test("PDF download failure never advances stored source revision", async () => {
  const fixture = watcherFixture();
  await fixture.watcher.run();
  const previous = structuredClone(fixture.stateStore.state.slots["medicine:1:1:combined"]);
  fixture.watcher.fetch = async (url) => url === fixture.sourcePage ? response(page()) : response("unavailable", { status: 503 });
  const result = await fixture.watcher.run();
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.errorCount, 1);
  assert.equal(fixture.observer.calls.length, 1);
  assert.deepEqual(fixture.stateStore.state.slots["medicine:1:1:combined"].sha256, previous.sha256);
});

test("wrong official page period creates no source review", async () => {
  const fixture = watcherFixture({ pageHtml: `<h2>Расписание учебных занятий 2025/2026 учебный год, весенний семестр</h2><a href="https://omsk-osma.ru/files/1lech.pdf">1 курс леч 1 поток</a>` });
  const result = await fixture.watcher.run();
  assert.equal(result.targetCount, 0);
  assert.equal(result.newReviewCount, 0);
  assert.equal(fixture.observer.calls.length, 0);
  assert.equal(result.status, "PARTIAL");
});

test("source observer only stages exact PDF and creates blocked review metadata", async () => {
  const calls = { source: [], review: [] };
  const queue = {
    async storeSource(buffer, sha, filename) { calls.source.push({ buffer: Buffer.from(buffer), sha, filename }); return `parser-staging/omgmu/sources/${sha}/${filename}`; },
    async createReview(value) { calls.review.push(value); return { reviewId: "00000000-0000-0000-0000-000000000001", university: "omgmu", ...value }; },
  };
  const observer = new OmgmuSourceObserver({ queue });
  const result = await observer.observeSource(Buffer.from("%PDF-1.7\nexact"), { sourceUrl: "https://example.test/a.pdf", program: "medicine", course: 1, academicYear: "2026/27", semester: 1 });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.publicationBlocked, true);
  assert.equal(calls.source.length, 1);
  assert.equal(calls.review[0].classification.reason, "server-pdf-interpretation-disabled");
  assert.equal(calls.review[0].currentPublishedSchedulePreserved, true);
});

test("ОмГМУ server watcher is disabled by default and code imports no parser or publisher", async () => {
  const config = loadConfig({});
  assert.equal(config.omgmuWatchEnabled, false);
  const watcherPath = fileURLToPath(new URL("../src/adapters/omgmu/source-watcher.mjs", import.meta.url));
  const observerPath = fileURLToPath(new URL("../src/adapters/omgmu/source-observer.mjs", import.meta.url));
  const source = `${await fs.readFile(watcherPath, "utf8")}\n${await fs.readFile(observerPath, "utf8")}`;
  assert.doesNotMatch(source, /parse-weekly|parse-fourth|parse-fifth|publishScheduleBatch|putSchedule|DeleteObject/);
});
