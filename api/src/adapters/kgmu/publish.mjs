import { createHash } from "node:crypto";
import { normalizeAcademicYear, scheduleStorageKey } from "../../order-context.js";

const TIMEZONE = "Europe/Moscow";
const OFFSET = "+03:00";

function isoDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("invalid-event-date");
  if (!/^\d{2}:\d{2}$/.test(String(time || ""))) throw new Error("invalid-event-time");
  return `${date}T${time}:00${OFFSET}`;
}

function stableId(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function sourceDescriptor(quality) {
  return {
    type: "official-xlsx",
    title: "Официальное расписание КГМУ",
    url: quality.sourceUrl,
    sha256: quality.sourceSha256,
    sourceFile: quality.sourceFile,
  };
}

function baseSchedule(quality) {
  const academicYear = normalizeAcademicYear(quality.academicYear);
  const semester = Number(quality.semester);
  if (!academicYear || ![1, 2].includes(semester)) throw new Error("invalid-publication-period");
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: quality.program,
    course: Number(quality.course),
    group: {
      id: quality.groupId,
      code: quality.groupCode,
      displayName: `Группа ${quality.groupCode}`,
    },
    timezone: TIMEZONE,
    academicYear,
    semester,
    sources: [sourceDescriptor(quality)],
    events: [],
  };
}

function weeklyEvents(groupData, quality) {
  return (groupData?.events || []).map((event) => ({
    id: event.id || stableId([
      quality.groupId,
      event.date,
      event.start,
      event.end,
      event.title,
      event.sourceCell || "",
    ]),
    title: event.title,
    start: isoDateTime(event.date, event.start),
    end: isoDateTime(event.date, event.end),
    location: event.locationText || "",
    sourceType: "official-xlsx",
    sourceCell: event.sourceCell || null,
    sourceRaw: event.raw || null,
  }));
}

function blockTime(block, index) {
  const timing = block?.timing || {};
  if (timing.status !== "resolved") throw new Error("unresolved-calendar-time");
  if (timing.allDatesTime) return timing.allDatesTime;
  if (index === 0 && timing.firstDateTime) return timing.firstDateTime;
  if (index > 0 && timing.remainingDatesTime) return timing.remainingDatesTime;
  throw new Error("unresolved-calendar-time");
}

function calendarEvents(groupData, quality) {
  const events = [];
  for (const block of groupData?.blocks || []) {
    if (block?.kind !== "discipline-cycle") continue;
    if (block?.status !== "matched" || block?.requiresReview) throw new Error("unresolved-calendar-block");
    const title = block.metadataMatch || block.raw;
    const location = block.address || block.practiceBase || "";
    const dates = Array.isArray(block.dates) ? block.dates : [];
    for (const [index, date] of dates.entries()) {
      const time = blockTime(block, index);
      events.push({
        id: stableId([
          quality.groupId,
          date,
          time.start,
          time.end,
          title,
          block.sourceCell || "",
        ]),
        title,
        start: isoDateTime(date, time.start),
        end: isoDateTime(date, time.end),
        location,
        sourceType: "official-xlsx",
        sourceCell: block.sourceCell || null,
        sourceRaw: block.raw || null,
      });
    }
  }
  return events;
}

function reportByFile(bundle, sourceFile) {
  return (bundle?.reports || []).find((report) => report?.sourceFile === sourceFile) || null;
}

export function buildKgmuSchedule({ quality, weeklyReport, calendarReport } = {}) {
  if (!quality || quality.status !== "ready-for-publication-plan") {
    throw new Error("group-not-ready-for-publication-plan");
  }
  if (!quality.sourceSha256 || !/^[a-f0-9]{64}$/i.test(quality.sourceSha256)) {
    throw new Error("missing-source-hash");
  }
  const schedule = baseSchedule(quality);
  const report = reportByFile(
    quality.layout === "weekly-grid" ? weeklyReport : calendarReport,
    quality.sourceFile,
  );
  if (!report) throw new Error("parser-report-not-found");
  const groupData = report.groups?.[quality.groupCode];
  if (!groupData) throw new Error("parser-group-not-found");
  schedule.events = quality.layout === "weekly-grid"
    ? weeklyEvents(groupData, quality)
    : calendarEvents(groupData, quality);
  if (!schedule.events.length) throw new Error("empty-schedule");
  schedule.events.sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title, "ru"));
  return schedule;
}

export function buildKgmuPublicationPlan({ qualityReport, weeklyReport, calendarReport } = {}) {
  const entries = (qualityReport?.groups || []).map((quality) => {
    if (quality.status === "archive-reference") {
      return {
        group: quality.groupCode,
        publish: false,
        reason: "archive-reference",
        quality,
      };
    }
    if (quality.status !== "ready-for-publication-plan") {
      return {
        group: quality.groupCode,
        publish: false,
        reason: "parser-qa-blocked",
        quality,
      };
    }
    try {
      const schedule = buildKgmuSchedule({ quality, weeklyReport, calendarReport });
      return {
        group: quality.groupCode,
        publish: true,
        reason: "verified-dry-run",
        key: scheduleStorageKey(schedule),
        quality,
        schedule,
      };
    } catch (error) {
      return {
        group: quality.groupCode,
        publish: false,
        reason: error.message || "schedule-build-failed",
        quality,
      };
    }
  });

  return {
    version: 1,
    university: "kgmu",
    generatedAt: new Date().toISOString(),
    dryRun: true,
    publishable: entries.filter((entry) => entry.publish),
    blocked: entries.filter((entry) => !entry.publish),
  };
}
