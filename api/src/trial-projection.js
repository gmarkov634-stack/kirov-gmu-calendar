import { createHash } from "node:crypto";

const DATE = /^20\d{2}-\d{2}-\d{2}$/;

function canonical(schedule) {
  return schedule?.schema_version === "1.0" && Boolean(schedule?.schedule) && Array.isArray(schedule?.events);
}

function eventDate(event, isCanonical) {
  const value = isCanonical ? event?.timing?.date : String(event?.start || "").slice(0, 10);
  return DATE.test(String(value || "")) ? String(value) : null;
}

function localPlainDate(value, timezone) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError("valid activation time is required");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(value, days) {
  if (!DATE.test(String(value || "")) || !Number.isInteger(days)) throw new TypeError("valid date and integer days are required");
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function trialWindowFromSchedule(schedule, { activationAt = null, timezone = null } = {}) {
  const isCanonical = canonical(schedule);
  const dates = (schedule?.events || [])
    .map((event) => eventDate(event, isCanonical))
    .filter(Boolean)
    .sort();
  if (!dates.length) return null;

  const firstScheduleDate = dates[0];
  const lastScheduleDate = dates[dates.length - 1];
  const resolvedTimezone = timezone || schedule?.schedule?.timezone || schedule?.timezone || "UTC";
  const activationDate = activationAt == null ? firstScheduleDate : localPlainDate(activationAt, resolvedTimezone);

  if (activationDate > lastScheduleDate) {
    return {
      trialWindowClosed: true,
      firstScheduleDate,
      lastScheduleDate,
    };
  }

  const trialStartDate = activationDate < firstScheduleDate ? firstScheduleDate : activationDate;
  const trialEndDateExclusive = addCalendarDays(trialStartDate, 7);
  const scheduleEventCount = dates.filter((date) => date >= trialStartDate && date < trialEndDateExclusive).length;

  return {
    trialStartDate,
    trialEndDateExclusive,
    scheduleEventCount,
    firstScheduleDate,
    lastScheduleDate,
  };
}

function deterministicId(trial) {
  const basis = String(trial?.conversionId || `${trial?.groupId || "group"}:${trial?.trialEndDateExclusive || "trial"}`);
  return createHash("sha256").update(basis).digest("hex");
}

function conversionDescription(continueUrl) {
  return [
    "Первая бесплатная неделя закончилась.",
    continueUrl ? `Подключить календарь своей группы на весь семестр: ${continueUrl}` : null,
  ].filter(Boolean).join("\n\n");
}

function canonicalConversionEvent(schedule, trial, continueUrl) {
  const digest = deterministicId(trial);
  const stamp = trial?.createdAt || schedule?.schedule?.version_created_at || new Date(0).toISOString();
  return {
    schema_version: "1.0",
    system: {
      event_id: `evt_trial_conversion_${digest.slice(0, 24)}`,
      schedule_version_id: schedule.schedule.schedule_version_id,
      fingerprint: `sha256:${digest}`,
      revision: 1,
      created_at: stamp,
      updated_at: stamp,
    },
    timing: {
      date: trial.trialEndDateExclusive,
      start_time: null,
      end_time: null,
      all_day: true,
      time_mode: "floating",
    },
    calendar: {
      title: "Продолжить календарь на семестр",
      description: conversionDescription(continueUrl),
      location: null,
    },
  };
}

function legacyConversionEvent(trial, continueUrl) {
  const digest = deterministicId(trial);
  return {
    id: `trial-conversion-${digest.slice(0, 24)}`,
    title: "Продолжить календарь на семестр",
    description: conversionDescription(continueUrl),
    location: "",
    start: trial.trialEndDateExclusive,
    end: addCalendarDays(trial.trialEndDateExclusive, 1),
    allDay: true,
  };
}

export function projectTrialSchedule(schedule, trial, { continueUrl = "" } = {}) {
  if (!schedule || !Array.isArray(schedule.events)) throw new TypeError("schedule with events is required");
  if (!DATE.test(String(trial?.trialStartDate || "")) || !DATE.test(String(trial?.trialEndDateExclusive || ""))) {
    throw new TypeError("trial window is invalid");
  }

  const isCanonical = canonical(schedule);
  if (trial.status !== "active") return { ...schedule, events: [] };

  const events = schedule.events.filter((event) => {
    const date = eventDate(event, isCanonical);
    return date && date >= trial.trialStartDate && date < trial.trialEndDateExclusive;
  });
  const conversion = isCanonical
    ? canonicalConversionEvent(schedule, trial, continueUrl)
    : legacyConversionEvent(trial, continueUrl);

  return { ...schedule, events: [...events, conversion] };
}