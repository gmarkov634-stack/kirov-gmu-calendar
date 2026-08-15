import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runIzhgmuSourceAdapter } from "../src/adapters/izhgmu/source-adapter.mjs";

const sourcePage = "https://example.test/schedule";
const xlsxUrl = "https://example.test/files/леч_1_Весна_25-26.xlsx";
const label = "Расписание занятий для студентов 1 курса лечебного факультета на весенний семестр 2025-2026 уч.г.";
const html = `<a href="${xlsxUrl}">${label}</a>`;
const xlsxA = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("A")]);
const xlsxB = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("B")]);

function response(body, { status = 200 } = {}) {
  return new Response(body, { status });
}

function fetchWithWorkbook(workbook) {
  return async (url) => {
    if (url === sourcePage) return response(html);
    if (url === xlsxUrl) return response(workbook);
    return response("not found", { status: 404 });
  };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "izhgmu-source-adapter-"));
}

test("first successful capture requires review and never publishes", async () => {
  const result = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    fetchFn: fetchWithWorkbook(xlsxA),
  });
  assert.equal(result.status, "review-required");
  assert.equal(result.publishable, false);
  assert.equal(result.diff.added.length, 1);
  assert.equal(result.routingCandidates.length, 1);
  assert.deepEqual(result.routingCandidates[0].routing, {
    status: "needs_source_review",
    reason: "workbook_structural_signature_required",
    structuralSignature: null,
    parserProfile: null,
  });
});

test("identical URL and hash is unchanged while parser routing remains unassigned", async () => {
  const first = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    fetchFn: fetchWithWorkbook(xlsxA),
  });
  const second = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    previousSnapshot: first.snapshot,
    fetchFn: fetchWithWorkbook(xlsxA),
  });
  assert.equal(second.status, "unchanged");
  assert.equal(second.diff.candidateCount, 0);
  assert.equal(second.publicationAction, "none");
  assert.equal(second.routingCandidates[0].routing.parserProfile, null);
});

test("same URL with changed workbook hash requires review", async () => {
  const first = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    fetchFn: fetchWithWorkbook(xlsxA),
  });
  const changed = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    previousSnapshot: first.snapshot,
    fetchFn: fetchWithWorkbook(xlsxB),
  });
  assert.equal(changed.status, "review-required");
  assert.equal(changed.diff.changed.length, 1);
  assert.equal(changed.publishable, false);
});

test("invalid workbook container is fail-closed", async () => {
  const failed = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    fetchFn: fetchWithWorkbook(Buffer.from("<html>error page</html>")),
  });
  assert.equal(failed.status, "source-error");
  assert.equal(failed.publishable, false);
  assert.equal(failed.publicationAction, "none");
  assert.equal(failed.snapshot, null);
  assert.equal(failed.diff, null);
  assert.match(failed.diagnostics[0].error, /does not match declared xlsx container/);
});

test("discovery metadata conflict blocks download and publication", async () => {
  const conflictHtml = `<a href="https://example.test/files/англ_леч_2_Весна_25-26.xlsx">Расписание лекций для англоязычных студентов 2 курса лечебного факультета на осенний семестр 2025-2026 уч.г.</a>`;
  const result = await runIzhgmuSourceAdapter({
    sourceUrl: sourcePage,
    outputDir: await tempDir(),
    fetchFn: async (url) => url === sourcePage ? response(conflictHtml) : response(xlsxA),
  });
  assert.equal(result.status, "needs-source-review");
  assert.equal(result.publishable, false);
  assert.equal(result.downloadReport, null);
  assert.match(result.diagnostics[0].error, /metadata conflict/);
});
