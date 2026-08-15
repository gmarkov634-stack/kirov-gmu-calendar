#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseWeeklyGeometry } from "../src/adapters/omgmu/weekly-geometry.mjs";
import { materializeWeeklyUserSeries } from "../src/adapters/omgmu/weekly-o65.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function ruleCounts(series) {
  const counts = {};
  for (const item of series) {
    for (const rule of item.ruleIds || []) counts[rule] = (counts[rule] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function blocker(item) {
  return {
    discipline: item.disciplineNormalized ?? item.discipline,
    groups: item.groups,
    startTime: item.startTime,
    endTime: item.endTime,
    dates: item.dates,
    ruleIds: item.ruleIds,
    warnings: item.warnings,
    references: (item.references || []).map((reference) => reference.range),
    rawSource: item.rawSource,
  };
}

async function main() {
  const inputDir = path.resolve(arg("input", "data/imports/omgmu-weekly-geometry"));
  const output = path.resolve(arg("output", "data/imports/omgmu-weekly-geometry-report.json"));
  const year = Number(arg("year", "2026"));
  const exceptions = String(arg("exceptions", "2026-05-01,2026-05-09,2026-06-12"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!Number.isInteger(year)) throw new TypeError("--year must be an integer");
  const names = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
  if (!names.length) throw new Error(`No weekly geometry JSON files found in ${inputDir}`);

  const files = [];
  for (const name of names) {
    const geometry = JSON.parse(await fs.readFile(path.join(inputDir, name), "utf8"));
    const parsed = parseWeeklyGeometry(geometry, { year, calendarExceptions: exceptions });
    const needsReview = parsed.series.filter((series) => series.status === "needs_review");
    const groups = parsed.groups.map((group) => {
      const sourceSeries = parsed.series.filter((series) => series.groups.includes(group));
      const groupNeedsReview = sourceSeries.filter((series) => series.status === "needs_review");
      const materialized = materializeWeeklyUserSeries(parsed.series, { group, maxGapMinutes: 5 });
      return {
        group,
        sourceSeries: sourceSeries.length,
        needsReviewSeries: groupNeedsReview.length,
        o65Merges: materialized.merges.length,
        publishableAtSourceLayer: parsed.diagnostics.length === 0 && groupNeedsReview.length === 0,
      };
    });

    files.push({
      fileName: name,
      pageNumber: geometry.pageNumber,
      groups,
      sourceSeries: parsed.series.length,
      needsReviewSeries: needsReview.length,
      diagnostics: parsed.diagnostics,
      ruleCounts: ruleCounts(parsed.series),
      blockers: needsReview.map(blocker),
    });
  }

  const report = {
    version: 1,
    sourceProfile: "weekly_grid",
    sourceLanguage: "ru",
    year,
    calendarExceptions: exceptions,
    files,
    totals: {
      files: files.length,
      groups: files.reduce((sum, file) => sum + file.groups.length, 0),
      sourceSeries: files.reduce((sum, file) => sum + file.sourceSeries, 0),
      needsReviewSeries: files.reduce((sum, file) => sum + file.needsReviewSeries, 0),
      diagnostics: files.reduce((sum, file) => sum + file.diagnostics.length, 0),
      o65Merges: files.reduce((sum, file) => sum + file.groups.reduce((groupSum, group) => groupSum + group.o65Merges, 0), 0),
      sourceLayerPublishableGroups: files.reduce(
        (sum, file) => sum + file.groups.filter((group) => group.publishableAtSourceLayer).length,
        0,
      ),
    },
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.totals));
  for (const file of files) {
    console.log(`${file.fileName}: groups=${file.groups.length} series=${file.sourceSeries} review=${file.needsReviewSeries} diagnostics=${file.diagnostics.length}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
