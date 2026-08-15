#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  combinedRotationInternals,
  parseCombinedRotationGeometry,
} from "../src/adapters/omgmu/combined-rotation-table.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function recordSummary(record) {
  return {
    discipline: record.discipline,
    pageNumber: record.geometry.pageNumber,
    rowIndex: record.geometry.rowIndex,
    schemaInherited: record.geometry.schemaInherited,
    kind: record.kind,
    startTime: record.startTime,
    endTime: record.endTime,
    mainRange: record.mainRange,
    resolvedMainDates: record.mainDates.length,
    declaredDays: record.declaredDays,
    control: record.control,
    o70Composite: record.o70Composite,
    status: record.status,
    warnings: record.warnings,
    ruleIds: record.ruleIds,
    references: record.references.map((reference) => reference.range),
  };
}

async function main() {
  const input = path.resolve(arg("input", "data/imports/omgmu-combined-rotation-geometry.json"));
  const output = path.resolve(arg("output", "data/imports/omgmu-combined-rotation-report.json"));
  const year = Number(arg("year", "2026"));
  const exceptions = String(arg("exceptions", "2026-05-01,2026-05-09,2026-06-12"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!Number.isInteger(year)) throw new TypeError("--year must be an integer");
  const geometry = JSON.parse(await fs.readFile(input, "utf8"));
  const parsed = parseCombinedRotationGeometry(geometry, { year, calendarExceptions: exceptions });
  const userSeries = parsed.sourceSeries.flatMap(combinedRotationInternals.materializeRecord);
  const eventCount = userSeries.reduce((sum, series) => sum + series.dates.length, 0);
  const inherited = parsed.sourceSeries.filter((record) => record.ruleIds.includes("O69"));
  const o70 = parsed.sourceSeries.filter((record) => record.ruleIds.includes("O70"));
  const blocked = parsed.sourceSeries.filter((record) => record.status === "needs_review");

  const report = {
    version: 1,
    sourceProfile: "combined_rotation_table",
    sourceLanguage: "ru",
    year,
    calendarExceptions: exceptions,
    group: parsed.group,
    columnSchema: geometry.columnSchema,
    localEnvelope: geometry.localEnvelope,
    pages: geometry.pages.map((page) => ({
      pageNumber: page.pageNumber,
      schemaInherited: page.schemaInherited,
      schemaFromPage: page.schemaFromPage,
      rows: page.rows.length,
    })),
    sourceSeries: parsed.sourceSeries.length,
    userSeries: userSeries.length,
    canonicalEventCount: eventCount,
    needsReviewSeries: blocked.length,
    diagnostics: parsed.diagnostics,
    o69InheritedSeries: inherited.length,
    o70CompositeSeries: o70.length,
    sourceLayerPublishable: parsed.diagnostics.length === 0 && blocked.length === 0,
    records: parsed.sourceSeries.map(recordSummary),
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    group: report.group,
    sourceSeries: report.sourceSeries,
    userSeries: report.userSeries,
    canonicalEventCount: report.canonicalEventCount,
    needsReviewSeries: report.needsReviewSeries,
    diagnostics: report.diagnostics.length,
    o69InheritedSeries: report.o69InheritedSeries,
    o70CompositeSeries: report.o70CompositeSeries,
    sourceLayerPublishable: report.sourceLayerPublishable,
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
