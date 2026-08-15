#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseCycleRotationGeometry } from "../src/adapters/omgmu/cycle-rotation-grid.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function blocker(record) {
  return {
    discipline: record.discipline,
    cycleNo: record.cycleNo,
    groups: record.groups,
    kind: record.kind,
    sourceSlots: record.sourceSlots,
    mainRange: record.mainRange,
    resolvedMainDates: record.mainDates.length,
    control: record.control,
    declaredDays: record.declaredDays,
    ruleIds: record.ruleIds,
    warnings: record.warnings,
    references: record.references.map((reference) => reference.range),
    rawSource: record.rawSource,
  };
}

async function main() {
  const input = path.resolve(arg("input", "data/imports/omgmu-cycle-rotation-geometry.json"));
  const output = path.resolve(arg("output", "data/imports/omgmu-cycle-rotation-report.json"));
  const year = Number(arg("year", "2026"));
  const exceptions = String(arg("exceptions", "2026-05-01,2026-05-09,2026-06-12"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const geometry = JSON.parse(await fs.readFile(input, "utf8"));
  const parsed = parseCycleRotationGeometry(geometry, { year, calendarExceptions: exceptions });
  const groups = parsed.groups.map((group) => {
    const records = parsed.sourceSeries.filter((record) => record.groups.includes(group));
    const blocked = records.filter((record) => record.status === "needs_review");
    return {
      group,
      sourceSeries: records.length,
      needsReviewSeries: blocked.length,
      publishableAtSourceLayer: parsed.diagnostics.length === 0 && blocked.length === 0,
    };
  });

  const report = {
    version: 1,
    sourceProfile: "cycle_rotation_grid",
    sourceLanguage: "ru",
    year,
    calendarExceptions: exceptions,
    cycles: geometry.cycles.map((cycle) => ({
      cycleNo: cycle.cycleNo,
      pageNumber: cycle.pageNumber,
      envelope: cycle.envelope,
      rows: cycle.rows.length,
    })),
    groups,
    sourceSeries: parsed.sourceSeries.length,
    needsReviewSeries: parsed.sourceSeries.filter((record) => record.status === "needs_review").length,
    diagnostics: parsed.diagnostics,
    blockers: parsed.sourceSeries.filter((record) => record.status === "needs_review").map(blocker),
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    groups: groups.length,
    sourceSeries: report.sourceSeries,
    needsReviewSeries: report.needsReviewSeries,
    diagnostics: report.diagnostics.length,
    publishableGroups: groups.filter((group) => group.publishableAtSourceLayer).length,
  }));
  for (const group of groups) console.log(`${group.group}: series=${group.sourceSeries} review=${group.needsReviewSeries}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
