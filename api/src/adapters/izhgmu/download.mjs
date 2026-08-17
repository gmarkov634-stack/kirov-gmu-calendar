import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

function safePart(value) {
  return String(value ?? "none").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function sourceFilename(source, index) {
  const extension = source.sourceFormat === "xls" ? "xls" : "xlsx";
  return [
    String(index + 1).padStart(2, "0"),
    safePart(source.program),
    `course-${safePart(source.course)}`,
    source.stream ? `stream-${safePart(source.stream)}` : null,
    safePart(source.sourceRole || "unknown"),
  ].filter(Boolean).join("_") + `.${extension}`;
}

function isXlsx(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function isXls(buffer) {
  const magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

function validateExcelContainer(buffer, sourceFormat) {
  if (sourceFormat === "xlsx") return isXlsx(buffer);
  if (sourceFormat === "xls") return isXls(buffer);
  return false;
}

export async function downloadIzhgmuSources({ manifest, outputDir, fetchFn = fetch } = {}) {
  if (!manifest || manifest.university !== "izhgmu" || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid Ижевский ГМУ manifest");
  }
  if (!outputDir) throw new Error("Output directory is required");

  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true });
  const results = [];

  for (const [index, source] of manifest.sources.entries()) {
    const filename = sourceFilename(source, index);
    const target = path.join(directory, filename);
    try {
      if (!["xlsx", "xls"].includes(source.sourceFormat)) throw new Error("Unsupported Excel source format");
      const response = await fetchFn(source.url, {
        headers: {
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source download)",
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream;q=0.9,*/*;q=0.1",
        },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!validateExcelContainer(buffer, source.sourceFormat)) {
        throw new Error(`Response does not match declared ${source.sourceFormat} container`);
      }
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
    university: "izhgmu",
    downloadedAt: new Date().toISOString(),
    sourceCount: manifest.sources.length,
    downloadedCount: results.filter((item) => item.status === "downloaded").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    files: results,
  };
  await fs.writeFile(path.join(directory, "download-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
