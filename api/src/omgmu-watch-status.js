function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function compactAcademicYear(value) {
  const match = String(value || "").match(/(20\d{2})\s*[\/-]\s*(20)?(\d{2})/);
  return match ? `${match[1]}/${match[3]}` : null;
}

function safeSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    status: summary.status === "PARTIAL" ? "PARTIAL" : "OK",
    checkedAt: summary.checkedAt || null,
    expectedAcademicYear: summary.expectedAcademicYear || null,
    expectedSemester: Number(summary.expectedSemester) || null,
    observedAcademicYear: summary.observedAcademicYear || null,
    observedSemester: Number(summary.observedSemester) || null,
    discoveredCount: Math.max(0, Number(summary.discoveredCount) || 0),
    targetCount: Math.max(0, Number(summary.targetCount) || 0),
    newReviewCount: Math.max(0, Number(summary.newReviewCount) || 0),
    changedReviewCount: Math.max(0, Number(summary.changedReviewCount) || 0),
    unchangedCount: Math.max(0, Number(summary.unchangedCount) || 0),
    missingCount: Math.max(0, Number(summary.missingCount) || 0),
    errorCount: Math.max(0, Number(summary.errorCount) || 0),
    publicationAction: summary.publicationAction === "review-required" ? "review-required" : "none",
  };
}

function reviewMatchesPeriod(review, config) {
  const metadata = review?.metadata || {};
  return compactAcademicYear(metadata.academicYear) === compactAcademicYear(config.offerAcademicYear)
    && Number(metadata.semester) === Number(config.offerSemester);
}

function countStatuses(reviews, config) {
  const counts = {
    reviewRequired: 0,
    readyToPublish: 0,
    published: 0,
  };
  for (const review of reviews || []) {
    if (!reviewMatchesPeriod(review, config)) continue;
    if (review.status === "REVIEW_REQUIRED") counts.reviewRequired += 1;
    else if (review.status === "READY_TO_PUBLISH") counts.readyToPublish += 1;
    else if (review.status === "PUBLISHED") counts.published += 1;
  }
  return counts;
}

function sourceState(summary, counts) {
  if (counts.reviewRequired > 0) return "REVIEW_REQUIRED";
  if (counts.readyToPublish > 0) return "READY_TO_PUBLISH";
  if (counts.published > 0) return "PUBLISHED_REVIEW_EXISTS";
  if ((summary?.targetCount || 0) > 0) return "SOURCE_OBSERVED";
  return "WAITING_SOURCE";
}

export function createOmgmuWatchStatusHandler({ stateStore, reviewQueue, config }) {
  return async function omgmuWatchStatusHandler(request, response) {
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });
    try {
      const [state, reviews] = await Promise.all([
        stateStore.read(),
        reviewQueue?.listReviews ? reviewQueue.listReviews({ limit: 500 }) : [],
      ]);
      const summary = safeSummary(state.lastRunSummary);
      const reviewCounts = countStatuses(reviews, config);
      return send(response, 200, {
        university: "omgmu",
        enabled: Boolean(config.omgmuWatchEnabled),
        intervalMs: Number(config.omgmuWatchIntervalMs || 0),
        expectedAcademicYear: compactAcademicYear(config.offerAcademicYear),
        expectedSemester: Number(config.offerSemester) || null,
        sourceState: sourceState(summary, reviewCounts),
        lastRunAt: state.lastRunAt || null,
        lastRun: summary,
        reviews: reviewCounts,
        publicationMode: "explicit-only",
      });
    } catch (error) {
      console.error("OMGMU watcher status failed", error);
      return send(response, 503, { error: "omgmu_watch_status_unavailable" });
    }
  };
}
