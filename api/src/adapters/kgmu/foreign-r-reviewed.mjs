import { parseForeignRWorkbookSafe } from "./foreign-r-safe.mjs";

function explicitMode(value) {
  return String(value || "").startsWith("explicit");
}

function eventIndex(parsed) {
  const result = new Map();
  for (const schedule of parsed?.schedules || []) {
    for (const event of schedule.events || []) result.set(event.id, event);
  }
  return result;
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

function refreshReviewedQa(parsed) {
  const qa = parsed.qa || {};
  const conflicts = classifySourceConflicts(parsed);
  qa.allowedOverlaps = conflicts.allowed;
  qa.remainingOverlaps = conflicts.blocking;
  qa.sourcePeriodExceptions = qa.outOfPeriodSources || [];
  delete qa.sourceConflicts;
  delete qa.outOfPeriodSources;

  const skippedSafetyFixups = qa.safetyFixups?.alternateTimeDateRanges?.skipped?.length || 0;
  qa.status = (
    qa.uncovered?.length ||
    qa.extraLessonFailures?.length ||
    qa.remainingOverlaps?.length ||
    skippedSafetyFixups
  ) ? "REVIEW_REQUIRED" : "PASS";
  parsed.qa = qa;
  return parsed;
}

export function parseForeignRWorkbookReviewed(workbook, options = {}) {
  return refreshReviewedQa(parseForeignRWorkbookSafe(workbook, options));
}
