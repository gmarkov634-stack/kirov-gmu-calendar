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
  if (subscription?.plan === "semester") return semesterEndFromSchedule(schedule);
  const value = String(subscription?.expiresAt || "");
  if (!Number.isFinite(Date.parse(value))) {
    const error = new Error("Subscription end is invalid");
    error.code = "subscription_end_invalid";
    throw error;
  }
  return value;
}
