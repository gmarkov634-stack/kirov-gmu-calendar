import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { downloadUgmuSources } from "../src/adapters/ugmu/download.mjs";

const pdf = Buffer.from("%PDF-1.4\nUGMU TEST\n%%EOF\n", "utf8");
const source = {
  program: "medicine",
  semester: "autumn",
  course: 1,
  stream: "1",
  part: "combined",
  label: "1 курс I поток",
  url: "https://usma.ru/wp-content/uploads/2026/08/test.pdf",
};

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => String(body.length) },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  };
}

test("UGMU downloader captures exact PDF bytes and SHA-256", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-download-"));
  try {
    const manifest = { university: "ugmu", program: "medicine", sourcePage: "https://usma.ru/example/", sources: [source] };
    const report = await downloadUgmuSources({
      manifest,
      outputDir,
      semester: "autumn",
      fetchFn: async () => response(pdf),
    });

    assert.equal(report.downloadedCount, 1);
    assert.equal(report.failedCount, 0);
    assert.equal(report.files[0].sha256, createHash("sha256").update(pdf).digest("hex"));
    assert.equal(report.files[0].sourceKey, "medicine/autumn/course-1/stream-1/combined");
    const saved = await fs.readFile(path.join(outputDir, report.files[0].filename));
    assert.deepEqual(saved, pdf);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test("UGMU downloader fails closed for non-PDF response", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-download-"));
  try {
    const manifest = { university: "ugmu", program: "medicine", sourcePage: "https://usma.ru/example/", sources: [source] };
    const body = Buffer.from("not a pdf", "utf8");
    const report = await downloadUgmuSources({
      manifest,
      outputDir,
      fetchFn: async () => response(body),
    });
    assert.equal(report.downloadedCount, 0);
    assert.equal(report.failedCount, 1);
    assert.match(report.files[0].error, /not a PDF/i);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
