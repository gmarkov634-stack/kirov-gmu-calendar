import { buildOmgmuCanonicalBatch } from "./canonical.mjs";
import { parseWeeklyGeometry } from "./weekly-geometry.mjs";

function calendarYear(metadata) {
  const start = String(metadata?.period?.start_date ?? metadata?.period?.startDate ?? "").match(/^(20\d{2})-/);
  if (!start) throw new TypeError("weekly_grid metadata.period.start_date is required to determine calendar year");
  return Number(start[1]);
}

/**
 * Compose one group-specific canonical batch from authoritative weekly_grid
 * geometry. Shared PDF cells remain shared evidence; each group batch receives
 * the same source series plus `jointGroups` for the other geometrically covered
 * groups. O65 merging is intentionally not performed here.
 */
export function buildWeeklyGridCanonicalBatch(geometry, { metadata, source } = {}) {
  const group = String(metadata?.groupCode ?? metadata?.group ?? "").trim();
  if (!group) throw new TypeError("weekly_grid metadata.group is required");

  const parsed = parseWeeklyGeometry(geometry, {
    year: calendarYear(metadata),
    calendarExceptions: metadata?.calendarExceptions || [],
  });

  if (!parsed.groups.includes(group)) {
    const error = new Error(`weekly_grid geometry does not contain group ${group}`);
    error.code = "OMG_WEEKLY_GRID_GROUP_NOT_FOUND";
    throw error;
  }
  if (parsed.diagnostics.length) {
    const error = new Error(`weekly_grid has ${parsed.diagnostics.length} unresolved geometry/parser diagnostic(s)`);
    error.code = "OMG_WEEKLY_GRID_NEEDS_REVIEW";
    error.diagnostics = parsed.diagnostics;
    throw error;
  }

  const series = parsed.series
    .filter((item) => item.groups.includes(group))
    .map((item) => ({
      ...item,
      jointGroups: item.groups.filter((code) => code !== group),
    }));

  if (!series.length) {
    const error = new Error(`weekly_grid produced no source series for group ${group}`);
    error.code = "OMG_WEEKLY_GRID_EMPTY";
    throw error;
  }

  return buildOmgmuCanonicalBatch({
    metadata: {
      ...metadata,
      parser: metadata?.parser || "omgmu-weekly-grid/o01-o72",
    },
    source,
    series,
  });
}
