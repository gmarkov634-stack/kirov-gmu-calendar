const UNIVERSITY_OFFSETS = {
  kgmu: "+03:00",
  omgmu: "+06:00",
  pgmu: "+05:00",
  ugmu: "+05:00",
};

function canonicalSemesterEnd(schedule) {
  if (schedule?.schema_version !== "1.0" || !schedule?.schedule || !Array.isArray(schedule?.events)) return null;
  let latestDate = null;
  let latestTime = null;
  for (const event of schedule.events) {
    const date = event?.timing?.date;
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(date || ""))) continue;
    const time = event?.timing?.all_day === true ? "23:59" : event?.timing?.end_time;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) continue;
    if (latestDate === null || `${date}T${time}` > `${latestDate}T${latestTime}`) {
      latestDate = date;
      latestTime = time;
    }
  }
  if (!latestDate) {
    const periodEnd = schedule.schedule?.period?.end_date;
    if (/^20\d{2}-\d{2}-\d{2}$/.test(String(periodEnd || ""))) {
      latestDate = periodEnd;
      latestTime = "23:59";
    }
  }
  if (!latestDate) return null;
  const offset = UNIVERSITY_OFFSETS[schedule.schedule?.university_code] || "+00:00";
  return new Date(`${latestDate}T${latestTime}:00${offset}`).toISOString();
}

export function semesterEndFromSchedule(schedule) {
  const canonical = canonicalSemesterEnd(schedule);
  if (canonical) return canonical;

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
  const raw = subscription?.expiresAt;
  const timestamp = typeof raw === "number" ? raw : Date.parse(String(raw || ""));
  if (!Number.isFinite(timestamp)) {
    const error = new Error("Subscription end is invalid");
    error.code = "subscription_end_invalid";
    throw error;
  }
  return new Date(timestamp).toISOString();
}
