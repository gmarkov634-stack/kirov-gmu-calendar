import { parseForeignRWorkbookSafe } from "./foreign-r-safe.mjs";
import { parseForeignRWorkbookGeneric } from "./foreign-r-generic.mjs";
import { parseForeignRWorkbookGeneric as parseForeignRWorkbookGenericV2 } from "./foreign-r-generic-v2.mjs";

const WEEKDAYS = new Map([["пн", 1], ["вт", 2], ["ср", 3], ["чт", 4], ["пт", 5], ["сб", 6]]);
const EXTRA_LESSON_RE = /\((\d+)\s+занят(?:ие|ия)\s+(?:в(?:о)?\s*)?(пн|вт|ср|чт|пт|сб)\.?(?=\s*[,;)])/gi;

function explicitMode(value) {
  const mode = String(value || "");
  return mode === "date" || mode.startsWith("explicit");
}

function weekdayIso(date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function allEvents(parsed) {
  return (parsed?.schedules || []).flatMap((schedule) => schedule.events || []);
}

function eventIndex(parsed) {
  const result = new Map();
  for (const event of allEvents(parsed)) result.set(event.id, event);
  return result;
}

function augmentEmbeddedExtraLessonQa(parsed, workbook) {
  const qa = parsed.qa || (parsed.qa = {});
  qa.extraLessonExpectations ||= [];
  const events = allEvents(parsed);
  const keyOf = (item) => [
    item.group, item.subject, item.count, item.weekday, item.sourceCell,
  ].join("|");
  const existing = new Set(qa.extraLessonExpectations.map(keyOf));

  for (const sheet of workbook?.sheets || []) {
    for (const cell of sheet.cells || []) {
      const text = String(cell.value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      for (const match of text.matchAll(new RegExp(EXTRA_LESSON_RE.source, "gi"))) {
        const count = Number(match[1]);
        const weekday = WEEKDAYS.get(match[2].toLowerCase());
        const sourceEvents = events.filter((event) => event.sourceCell === cell.ref && event.kind === "practical" && event.subject);
        const subjects = [...new Set(sourceEvents.map((event) => event.subject))];
        if (subjects.length !== 1) continue;
        const subject = subjects[0];
        const groups = [...new Set(sourceEvents.filter((event) => event.subject === subject).map((event) => event.group))];
        for (const group of groups) {
          const expectation = {
            group,
            subject,
            count,
            weekday,
            sourceCell: cell.ref,
            raw: match[0],
          };
          const key = keyOf(expectation);
          if (existing.has(key)) continue;
          existing.add(key);
          qa.extraLessonExpectations.push(expectation);
        }
      }
    }
  }

  qa.extraLessonExpectations = qa.extraLessonExpectations.map((expectation) => {
    const matches = events.filter((event) => (
      event.group === expectation.group &&
      event.subject === expectation.subject &&
      event.kind === "practical" &&
      explicitMode(event.dateMode) &&
      weekdayIso(new Date(`${event.start.slice(0, 10)}T12:00:00Z`)) === expectation.weekday
    ));
    return {
      ...expectation,
      actual: matches.length,
      eventIds: matches.map((event) => event.id),
    };
  });
  qa.extraLessonFailures = qa.extraLessonExpectations.filter((item) => item.actual !== item.count);
  return parsed;
}

function sourceRange(sheet, cell) {
  const merge = (sheet.merges || []).find((item) => (
    item.startRow <= cell.row && cell.row <= item.endRow &&
    item.startCol <= cell.col && cell.col <= item.endCol
  ));
  return merge?.ref || cell.ref;
}

function detectAmbiguousLectureTimeCounts(workbook) {
  const issues = [];
  for (const sheet of workbook?.sheets || []) {
    for (const cell of sheet.cells || []) {
      const text = String(cell.value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      for (const match of text.matchAll(/\((\d+)\s+лекци(?:я|и|й)\s+(\d{1,2})[.:](\d{2})\s*\)/gi)) {
        issues.push({
          source: sourceRange(sheet, cell),
          sourceCell: cell.ref,
          count: Number(match[1]),
          time: `${String(Number(match[2])).padStart(2, "0")}:${match[3]}`,
          raw: match[0],
          reason: "lecture-time-count-without-dates",
          text,
        });
      }
    }
  }
  return issues;
}

function detectChoiceDisciplineAmbiguities(workbook) {
  const issues = [];
  for (const sheet of workbook?.sheets || []) {
    for (const cell of sheet.cells || []) {
      const text = String(cell.value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const departmentMentions = (text.match(/\(каф\.[^)]*\)/gi) || []).length;
      let reason = null;
      if (/дисциплина\s+по\s+выбору/i.test(text) && departmentMentions >= 2) {
        reason = "choice-lecture-variants-not-separated";
      } else if (departmentMentions >= 2 && /пр\.\s*занят/i.test(text)) {
        reason = "choice-practical-variants-not-separated";
      }
      if (reason) {
        issues.push({
          source: sourceRange(sheet, cell),
          sourceCell: cell.ref,
          reason,
          departmentMentions,
          text,
        });
      }
    }
  }
  return issues;
}

function classifySourceConflicts(parsed) {
  const events = eventIndex(parsed);
  const allowed = [];
  const blocking = [];
  for (const conflict of parsed?.qa?.sourceConflicts || []) {
    const a = events.get(conflict.event1);
    const b = events.get(conflict.event2);
    const enriched = {
      ...conflict,
      title1: a?.title || null,
      title2: b?.title || null,
      start1: a?.start || null,
      end1: a?.end || null,
      start2: b?.start || null,
      end2: b?.end || null,
      dateMode1: a?.dateMode || null,
      dateMode2: b?.dateMode || null,
      source1: a?.sourceRange || conflict.source1 || null,
      source2: b?.sourceRange || conflict.source2 || null,
    };
    if (explicitMode(enriched.dateMode1) && explicitMode(enriched.dateMode2)) allowed.push(enriched);
    else blocking.push(enriched);
  }
  return { allowed, blocking };
}

function refreshReviewedQa(parsed, workbook) {
  const qa = parsed.qa || {};
  const conflicts = classifySourceConflicts(parsed);
  qa.allowedOverlaps = conflicts.allowed;
  qa.remainingOverlaps = conflicts.blocking;
  qa.sourcePeriodExceptions = qa.sourcePeriodExceptions || qa.outOfPeriodSources || [];
  qa.ambiguousLectureTimeCounts = detectAmbiguousLectureTimeCounts(workbook);
  qa.choiceDisciplineAmbiguities = detectChoiceDisciplineAmbiguities(workbook);
  delete qa.sourceConflicts;
  delete qa.outOfPeriodSources;

  const skippedSafetyFixups = qa.safetyFixups?.alternateTimeDateRanges?.skipped?.length || 0;
  qa.status = (
    qa.uncovered?.length ||
    qa.extraLessonFailures?.length ||
    qa.remainingOverlaps?.length ||
    qa.ambiguousLectureTimeCounts.length ||
    qa.choiceDisciplineAmbiguities.length ||
    skippedSafetyFixups
  ) ? "REVIEW_REQUIRED" : "PASS";
  parsed.qa = qa;
  return parsed;
}

function shouldUseGenericV2(workbook) {
  return (workbook?.sheets || []).some((sheet) =>
    (sheet.cells || []).some((cell) =>
      /[12]\s+недел[яи]\s+по\s+\d{1,2}\.\d{2}/i.test(String(cell.value || ""))
    )
  );
}

function shouldUseGeneric(legacy) {
  const uncovered = legacy?.qa?.uncovered || [];
  return uncovered.some((item) => ["segments-not-found", "no-events", "no-dates", "weekday-not-found"].includes(item?.reason));
}

export function parseForeignRWorkbookReviewed(workbook, options = {}) {
  const legacy = parseForeignRWorkbookSafe(workbook, options);
  const parsed = shouldUseGenericV2(workbook)
    ? parseForeignRWorkbookGenericV2(workbook, options)
    : shouldUseGeneric(legacy)
      ? parseForeignRWorkbookGeneric(workbook, options)
      : legacy;
  return refreshReviewedQa(augmentEmbeddedExtraLessonQa(parsed, workbook), workbook);
}
