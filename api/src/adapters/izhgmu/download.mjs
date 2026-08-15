import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalizeIzhgmuUrl } from "./discover.mjs";

const DEFAULT_CONCURRENCY = 4;
const MAX_BYTES = 25 * 1024 * 1024;

function safePart(value) {
  return String(value ?? "none").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function detectSpreadsheetKind(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const sig = `${buffer[2].toString(16).padStart(2, "0")}${buffer[3].toString(16).padStart(2, "0")}`;
    if (["0304", "0506", "0708"].includes(sig)) return "xlsx";
  }
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (buffer.length >= ole.length && buffer.subarray(0, ole.length).equals(ole)) return "xls";
  return null;
}

function filenameFor(source, index, kind) {
  return [
    String(index + 1).padStart(2, "0"),
    safePart(source.faculty),
    `course-${safePart(source.course)}`,
    source.stream ? `stream-${safePart(source.stream)}` : null,
    safePart(source.sourceKind),
    safePart(source.language || "ru"),
  ].filter(Boolean).join("_") + `.${kind}`;
}

async function fetchOne(source, index, directory, fetchFn) {
  const sourceUrl = canonicalizeIzhgmuUrl(source.url);
  const response = await fetchFn(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+IzhGMU schedule download)",
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream;q=0.9,*/*;q=0.1",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > MAX_BYTES) throw new Error("source-too-large");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error("source-too-large");
  const kind = detectSpreadsheetKind(buffer);
  if (!kind) throw new Error("response-is-not-spreadsheet");

  const filename = filenameFor(source, index, kind);
  await fs.writeFile(path.join(directory, filename), buffer);
  return {
    ...source,
    url: sourceUrl,
    status: "downloaded",
    filename,
    spreadsheetKind: kind,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    finalUrl: response.url || sourceUrl,
    contentType: response.headers?.get?.("content-type") || null,
    parserProfile: null,
    parserRouting: "fingerprint-required",
  };
}

export async function downloadIzhgmuSources({
  manifest,
  outputDir,
  fetchFn = fetch,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  if (!manifest || manifest.university !== "izhgmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid IzhGMU manifest");
  }
  if (!outputDir) throw new Error("Output directory is required");

  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true });
  const results = new Array(manifest.sources.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= manifest.sources.length) return;
      const source = manifest.sources[index];
      try {
        results[index] = await fetchOne(source, index, directory, fetchFn);
      } catch (error) {
        results[index] = {
          ...source,
          url: canonicalizeIzhgmuUrl(source.url),
          status: "failed",
          error: error.message,
          parserProfile: null,
          parserRouting: "fingerprint-required",
        };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Number(concurrency) || DEFAULT_CONCURRENCY, 8));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const report = {
    version: 1,
    university: "izhgmu",
    downloadedAt: new Date().toISOString(),
    sourcePage: manifest.sourcePage,
    sourceCount: manifest.sources.length,
    downloadedCount: results.filter((item) => item?.status === "downloaded").length,
    failedCount: results.filter((item) => item?.status === "failed").length,
    parserDispatchReady: false,
    files: results,
  };

  await fs.writeFile(path.join(directory, "download-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
