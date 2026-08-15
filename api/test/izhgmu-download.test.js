import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { downloadIzhgmuSources } from "../src/adapters/izhgmu/download.mjs";

const SOURCE = {
  label: "Расписание занятий 1 курс",
  url: "https://example.test/schedule.xlsx",
  faculty: "medicine",
  course: 1,
  stream: "2",
  sourceKind: "class",
  language: "ru",
  parserProfile: null,
  parserRouting: "fingerprint-required",
};

test("downloads XLSX payload, hashes bytes and keeps parser routing unresolved", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "izhgmu-download-"));
  const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
  const report = await downloadIzhgmuSources({
    manifest: { university: "izhgmu", sources: [SOURCE] },
    outputDir,
    fetchFn: async () => new Response(payload, { status: 200 }),
  });
  assert.equal(report.downloadedCount, 1);
  assert.equal(report.failedCount, 0);
  assert.equal(report.parserDispatchReady, false);
  assert.equal(report.files[0].sha256, createHash("sha256").update(payload).digest("hex"));
  assert.equal(report.files[0].parserProfile, null);
  assert.equal(report.files[0].parserRouting, "fingerprint-required");
  assert.match(report.files[0].filename, /medicine_course-1_stream-2_class_ru\.xlsx$/);
});

test("rejects non-XLSX content without passing it to parser dispatch", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "izhgmu-download-"));
  const report = await downloadIzhgmuSources({
    manifest: { university: "izhgmu", sources: [SOURCE] },
    outputDir,
    fetchFn: async () => new Response("<html>error</html>", { status: 200 }),
  });
  assert.equal(report.downloadedCount, 0);
  assert.equal(report.failedCount, 1);
  assert.equal(report.parserDispatchReady, false);
  assert.match(report.files[0].error, /not an XLSX/);
});

test("rejects invalid manifest explicitly", async () => {
  await assert.rejects(
    () => downloadIzhgmuSources({ manifest: { university: "omgmu", sources: [] }, outputDir: "/tmp/none" }),
    /Invalid IzhGMU manifest/,
  );
});
