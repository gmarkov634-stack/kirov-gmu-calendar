function storedSubscriptionEnd(subscription) {
  const raw = subscription?.expiresAt;
  const timestamp = typeof raw === "number" ? raw : Date.parse(String(raw || ""));
  if (!Number.isFinite(timestamp)) {
    const error = new Error("Subscription end is invalid");
    error.code = "subscription_end_invalid";
    throw error;
  }
  return new Date(timestamp).toISOString();
}

export function semesterEndFromSchedule(schedule) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const event of schedule?.events || []) {
    const end = Date.parse(event?.end);
    if (Number.isFinite(end) && end > latest) latest = end;
  }
  if (!Number.isFinite(latest)) {
    const error = new Error("Published schedule has no valid class end time");
    error.code = "semester_end_not_found";
    throw error;
  }
  return new Date(latest).toISOString();
}

export function effectiveSubscriptionEnd(subscription, schedule) {
  if (subscription?.archiveTest === true) return storedSubscriptionEnd(subscription);
  if (subscription?.plan === "semester") return semesterEndFromSchedule(schedule);
  return storedSubscriptionEnd(subscription);
}
