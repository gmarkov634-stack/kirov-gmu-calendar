import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeKgmuAcademicYear } from "./discover.mjs";

function safePart(value) {
  return String(value ?? "none").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function sourceFilename(source, index) {
  const range = source.groupStart === source.groupEnd
    ? source.groupStart
    : `${source.groupStart}-${source.groupEnd}`;
  return [
    String(index + 1).padStart(2, "0"),
    safePart(source.program),
    `course-${safePart(source.course)}`,
    `groups-${safePart(range)}`,
  ].join("_") + ".xlsx";
}

function isXlsx(buffer) {
  return buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
}

export function selectKgmuTargetSources(manifest, { academicYear, semester } = {}) {
  if (!manifest || manifest.university !== "kgmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid KGMU manifest");
  }
  const expectedAcademicYear = normalizeKgmuAcademicYear(academicYear);
  const expectedSemester = Number(semester);
  if (!expectedAcademicYear) throw new Error("Invalid KGMU academic year selector");
  if (![1, 2].includes(expectedSemester)) throw new Error("Invalid KGMU semester selector");

  return manifest.sources.filter((source) =>
    normalizeKgmuAcademicYear(source.academicYear) === expectedAcademicYear &&
    Number(source.semester) === expectedSemester
  );
}

export async function downloadKgmuSources({ manifest, outputDir, academicYear, semester, fetchFn = fetch } = {}) {
  if (!outputDir) throw new Error("Output directory is required");
  const sources = selectKgmuTargetSources(manifest, { academicYear, semester });
  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true });
  const results = [];

  for (const [index, source] of sources.entries()) {
    const filename = sourceFilename(source, index);
    const target = path.join(directory, filename);
    try {
      const response = await fetchFn(source.url, {
        headers: {
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source download)",
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.1",
        },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isXlsx(buffer)) throw new Error("Response is not an XLSX/ZIP file");
      await fs.writeFile(target, buffer);
      results.push({
        ...source,
        status: "downloaded",
        filename,
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    } catch (error) {
      results.push({
        ...source,
        status: "failed",
        filename,
        error: error.message,
      });
    }
  }

  const report = {
    version: 1,
    university: "kgmu",
    academicYear: normalizeKgmuAcademicYear(academicYear),
    semester: Number(semester),
    downloadedAt: new Date().toISOString(),
    sourceCount: sources.length,
    downloadedCount: results.filter((item) => item.status === "downloaded").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    files: results,
  };
  await fs.writeFile(path.join(directory, "download-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
