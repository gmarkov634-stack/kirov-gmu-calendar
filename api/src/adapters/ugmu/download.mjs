import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { isTrustedUgmuArtifactUrl } from "./source-registry.mjs";

function safePart(value) {
  return String(value ?? "none").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function ugmuSourceKey(source = {}) {
  return [
    source.program || "unknown-program",
    source.semester || "unknown-semester",
    `course-${source.course ?? "unknown"}`,
    source.stream ? `stream-${source.stream}` : "all-streams",
    source.part || "combined",
  ].join("/");
}

function sourceFilename(source, index) {
  return [
    String(index + 1).padStart(2, "0"),
    safePart(source.program),
    safePart(source.semester),
    `course-${safePart(source.course)}`,
    source.stream ? `stream-${safePart(source.stream)}` : null,
    safePart(source.part || "combined"),
  ].filter(Boolean).join("_") + ".pdf";
}

function isPdf(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function downloadUgmuSources({
  manifest,
  outputDir,
  semester = null,
  maxBytes = 25 * 1024 * 1024,
  fetchFn = fetch,
} = {}) {
  if (!manifest || manifest.university !== "ugmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid UGMU manifest");
  }
  if (!outputDir) throw new Error("Output directory is required");

  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true });
  const selectedSources = semester
    ? manifest.sources.filter((item) => item.semester === semester)
    : manifest.sources;
  const results = [];

  for (const [index, source] of selectedSources.entries()) {
    const filename = sourceFilename(source, index);
    const target = path.join(directory, filename);
    const sourceKey = ugmuSourceKey(source);

    try {
      if (!isTrustedUgmuArtifactUrl(source.url)) throw new Error("Untrusted UGMU source URL");

      const response = await fetchFn(source.url, {
        headers: {
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+UGMU schedule source watch)",
          Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
        },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const advertisedLength = Number(response.headers?.get?.("content-length") || 0);
      if (advertisedLength > maxBytes) throw new Error(`PDF exceeds max size (${advertisedLength} > ${maxBytes})`);

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error(`PDF exceeds max size (${buffer.length} > ${maxBytes})`);
      if (!isPdf(buffer)) throw new Error("Response is not a PDF");

      const sha256 = createHash("sha256").update(buffer).digest("hex");
      await fs.writeFile(target, buffer);
      results.push({
        ...source,
        sourceKey,
        status: "downloaded",
        filename,
        bytes: buffer.length,
        sha256,
      });
    } catch (error) {
      results.push({
        ...source,
        sourceKey,
        status: "failed",
        filename,
        error: error.message,
      });
    }
  }

  const report = {
    version: 1,
    university: "ugmu",
    program: manifest.program,
    sourcePage: manifest.sourcePage,
    semesterFilter: semester,
    downloadedAt: new Date().toISOString(),
    sourceCount: selectedSources.length,
    downloadedCount: results.filter((item) => item.status === "downloaded").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    files: results,
  };

  await fs.writeFile(path.join(directory, "download-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
