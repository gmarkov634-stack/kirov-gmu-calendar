import { createHash } from "node:crypto";
import { parseForeignRWorkbook } from "./foreign-r-parser.mjs";

const DATE_TOKEN_RE = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;
const PERIOD_RE = /(\d{1,2})\.(\d{2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?:\.|-)(20\d{2})/g;
const CURATOR_LIST_TIME_RE = /час\s+куратора\s*\(((?:\d{1,2}\.\d{2}\s*,\s*)+)(\d{1,2}\.\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})\)/i;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function iso(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateObj(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function sourceCells(workbook) {
  const map = new Map();
  for (const sheet of workbook?.sheets || []) {
    for (const cell of sheet.cells || []) map.set(cell.ref, clean(cell.value));
  }
  return map;
}

function academicYearFromSchedules(parsed) {
  const label = parsed?.schedules?.[0]?.academicYear;
  const match = String(label || "").match(/^(20\d{2})\/(\d{2})$/);
  return match ? Number(match[1]) + 1 : null;
}

function parseDateToken(raw, year) {
  const match = String(raw || "").match(/(\d{1,2})\.(\d{2})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  return dateObj(year, month, day) ? iso(year, month, day) : null;
}

function curatorListOverride(text, year) {
  const match = clean(text).match(CURATOR_LIST_TIME_RE);
  if (!match) return null;
  const dates = [];
  const rawDates = `${match[1]}${match[2]}`;
  for (const item of rawDates.matchAll(DATE_TOKEN_RE)) {
    const date = parseDateToken(item[0], year);
    if (date) dates.push(date);
  }
  const start = `${pad(Number(match[3]))}:${pad(Number(match[4]))}`;
  const end = `${pad(Number(match[5]))}:${pad(Number(match[6]))}`;
  if (start >= end || !dates.length) return null;
  return { dates: new Set(dates), start, end };
}

function eventId(event, start, end) {
  const date = event.start.slice(0, 10);
  const title = event.title;
  const sourceCell = event.sourceCell || event.source || "";
  const sourceRange = event.sourceRange || sourceCell;
  const hash = createHash("sha1")
    .update([event.group, date, start, end, title, sourceCell, sourceRange].join("|"))
    .digest("hex")
    .slice(0, 16);
  return `kgmu-${event.group}-${date}-${start.replace(":", "")}-${hash}`;
}

function applyCuratorListTimes(parsed, workbook) {
  const cells = sourceCells(workbook);
  const year = academicYearFromSchedules(parsed) || 2026;
  const overrides = new Map();
  for (const [ref, text] of cells) {
    const override = curatorListOverride(text, year);
    if (override) overrides.set(ref, override);
  }
  if (!overrides.size) return 0;

  let changed = 0;
  for (const schedule of parsed.schedules || []) {
    schedule.events = (schedule.events || []).map((event) => {
      if (event.title !== "Час куратора") return event;
      const override = overrides.get(event.sourceCell);
      const date = event.start.slice(0, 10);
      if (!override?.dates.has(date)) return event;
      const oldStart = event.start.slice(11, 16);
      const oldEnd = event.end.slice(11, 16);
      if (oldStart === override.start && oldEnd === override.end) return event;
      changed += 1;
      return {
        ...event,
        id: eventId(event, override.start, override.end),
        start: `${date}T${override.start}:00+03:00`,
        end: `${date}T${override.end}:00+03:00`,
        dateMode: "date",
        note: event.note || "FIO: время после списка дат применяется ко всему списку",
      };
    }).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }
  return changed;
}

function parsePeriodWindows(workbook) {
  for (const sheet of workbook?.sheets || []) {
    for (const cell of sheet.cells || []) {
      const text = clean(cell.value);
      const windows = [];
      for (const match of text.matchAll(PERIOD_RE)) {
        const start = dateObj(Number(match[3]), Number(match[2]), Number(match[1]));
        const end = dateObj(Number(match[6]), Number(match[5]), Number(match[4]));
        if (start && end && end >= start) windows.push({ start, end, label: match[0] });
      }
      if (windows.length) return windows;
    }
  }
  return [];
}

function boundaryIssues(parsed, workbook, toleranceDays = 7) {
  const windows = parsePeriodWindows(workbook);
  if (!windows.length) return [];
  const tolerance = toleranceDays * 24 * 60 * 60 * 1000;
  const allowed = windows.map((window) => ({
    start: new Date(window.start.getTime() - tolerance),
    end: new Date(window.end.getTime() + tolerance),
  }));
  const bySource = new Map();
  for (const schedule of parsed.schedules || []) {
    for (const event of schedule.events || []) {
      const date = new Date(`${event.start.slice(0, 10)}T12:00:00Z`);
      if (allowed.some((window) => date >= window.start && date <= window.end)) continue;
      const source = event.sourceRange || event.sourceCell || event.source || "";
      const key = [event.group, event.title, source].join("|");
      if (!bySource.has(key)) bySource.set(key, { group: event.group, title: event.title, source, dates: [] });
      bySource.get(key).dates.push(event.start.slice(0, 10));
    }
  }
  return [...bySource.values()].map((issue) => ({
    ...issue,
    dates: [...new Set(issue.dates)].sort(),
  }));
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function sourceConflicts(parsed) {
  const byGroupDate = new Map();
  for (const schedule of parsed.schedules || []) {
    for (const event of schedule.events || []) {
      const key = `${event.group}|${event.start.slice(0, 10)}`;
      if (!byGroupDate.has(key)) byGroupDate.set(key, []);
      byGroupDate.get(key).push(event);
    }
  }
  const conflicts = [];
  for (const events of byGroupDate.values()) {
    const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (sorted[j].start >= sorted[i].end) break;
        if (!overlaps(sorted[i], sorted[j])) continue;
        conflicts.push({
          group: sorted[i].group,
          date: sorted[i].start.slice(0, 10),
          event1: sorted[i].id,
          event2: sorted[j].id,
          source1: sorted[i].sourceCell || sorted[i].source || null,
          source2: sorted[j].sourceCell || sorted[j].source || null,
        });
      }
    }
  }
  return conflicts;
}

function refreshQa(parsed, workbook, curatorFixups) {
  const qa = parsed.qa || {};
  const conflicts = sourceConflicts(parsed);
  const outOfPeriodSources = boundaryIssues(parsed, workbook);
  qa.sourceConflicts = conflicts;
  qa.outOfPeriodSources = outOfPeriodSources;
  qa.eventCount = (parsed.schedules || []).reduce((sum, schedule) => sum + (schedule.events || []).length, 0);
  qa.eventCountsByGroup = Object.fromEntries((parsed.schedules || []).map((schedule) => [schedule.group?.code, schedule.events?.length || 0]));
  qa.safetyFixups = { curatorListTimeEvents: curatorFixups, boundaryToleranceDays: 7 };
  qa.status = (qa.uncovered?.length || qa.extraLessonFailures?.length || conflicts.length || outOfPeriodSources.length)
    ? "REVIEW_REQUIRED"
    : "PASS";
  parsed.qa = qa;
  return parsed;
}

export function parseForeignRWorkbookSafe(workbook, options = {}) {
  const parsed = parseForeignRWorkbook(workbook, options);
  const curatorFixups = applyCuratorListTimes(parsed, workbook);
  return refreshQa(parsed, workbook, curatorFixups);
}
