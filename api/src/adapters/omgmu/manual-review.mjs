import crypto from "node:crypto";

export function sourceSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function eventsSha256(events) {
  const normalized = (events || []).map((event) => ({
    end: event?.end || "",
    location: event?.location || "",
    start: event?.start || "",
    title: event?.title || "",
  }));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function validateReview(review, { expectedGroup, sourceHash } = {}) {
  const errors = [];
  if (!review || review.version !== 1) errors.push("unsupported-version");
  if (!review?.group) errors.push("missing-group");
  if (expectedGroup && String(review?.group) !== String(expectedGroup)) errors.push("group-mismatch");
  if (!review?.sourceSha256) errors.push("missing-source-sha256");
  if (sourceHash && review?.sourceSha256 !== sourceHash) errors.push("source-changed");
  if (review?.status !== "approved") errors.push("not-approved");
  if (!review?.reviewedBy) errors.push("missing-reviewer");
  if (!review?.reviewedAt || Number.isNaN(Date.parse(review.reviewedAt))) errors.push("invalid-reviewed-at");
  if (!Array.isArray(review?.events) || review.events.length === 0) errors.push("empty-events");

  const seen = new Set();
  for (const [index, event] of (review?.events || []).entries()) {
    if (!event?.title?.trim()) errors.push(`event-${index}-missing-title`);
    if (!event?.start || Number.isNaN(Date.parse(event.start))) errors.push(`event-${index}-invalid-start`);
    if (!event?.end || Number.isNaN(Date.parse(event.end))) errors.push(`event-${index}-invalid-end`);
    if (event?.start && event?.end && Date.parse(event.end) <= Date.parse(event.start)) errors.push(`event-${index}-invalid-duration`);
    const key = [event?.start, event?.end, event?.title?.trim(), event?.location || ""].join("|");
    if (seen.has(key)) errors.push(`event-${index}-duplicate`);
    seen.add(key);
  }
  return { valid: errors.length === 0, errors };
}

export function applyApprovedReview(schedule, review, { sourceHash } = {}) {
  const check = validateReview(review, { expectedGroup: schedule?.group?.code, sourceHash });
  if (!check.valid) {
    const error = new Error(`Manual review is invalid: ${check.errors.join(", ")}`);
    error.code = "INVALID_MANUAL_REVIEW";
    error.details = check.errors;
    throw error;
  }
  return {
    ...schedule,
    review: {
      status: "approved",
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      sourceSha256: review.sourceSha256,
    },
    events: review.events.map((event, index) => ({
      id: event.id || `omgmu-${review.group}-manual-${index + 1}`,
      title: event.title.trim(),
      start: event.start,
      end: event.end,
      location: event.location || "",
      sourceType: "manual-review",
    })),
  };
}

export function applyApprovedDecision(
  schedule,
  approval,
  { sourceHash, userConfirmation, confirmedAt } = {},
) {
  const errors = [];
  const group = String(schedule?.group?.code || "");
  if (!approval || String(approval.group || "") !== group) errors.push("group-mismatch");
  if (!approval?.sourceSha256) errors.push("missing-source-sha256");
  if (sourceHash && approval?.sourceSha256 !== sourceHash) errors.push("source-changed");
  if (!Number.isInteger(approval?.eventCount) || approval.eventCount < 1) errors.push("invalid-event-count");
  if (!approval?.eventsSha256) errors.push("missing-events-sha256");
  if (!approval?.reviewedBy) errors.push("missing-reviewer");
  if (!approval?.reviewedAt || Number.isNaN(Date.parse(approval.reviewedAt))) errors.push("invalid-reviewed-at");
  if (!approval?.decision) errors.push("missing-decision");
  if (!userConfirmation) errors.push("missing-user-confirmation");
  if (!confirmedAt || Number.isNaN(Date.parse(confirmedAt))) errors.push("invalid-confirmed-at");

  const events = Array.isArray(schedule?.events) ? schedule.events : [];
  const actualHash = eventsSha256(events);
  if (events.length !== approval?.eventCount) errors.push("event-count-changed");
  if (approval?.eventsSha256 && actualHash !== approval.eventsSha256) errors.push("events-changed");

  if (errors.length) {
    const error = new Error(`Approved manual decision is invalid: ${errors.join(", ")}`);
    error.code = "INVALID_APPROVED_DECISION";
    error.details = errors;
    throw error;
  }

  return {
    ...schedule,
    review: {
      status: "approved",
      reviewedBy: approval.reviewedBy,
      reviewedAt: approval.reviewedAt,
      sourceSha256: approval.sourceSha256,
      eventsSha256: approval.eventsSha256,
      decision: approval.decision,
      userConfirmation,
      confirmedAt,
    },
    events: events.map((event) => ({
      ...event,
      sourceType: "manual-review",
    })),
  };
}
