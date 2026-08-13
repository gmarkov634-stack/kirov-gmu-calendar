const DEFAULT_SERVICE_URL = "https://gmarkov634-stack.github.io/kirov-gmu-calendar/";

const TYPE_LABELS = {
  lecture: "Лекция",
  practice: "Практическое занятие",
  seminar: "Семинар",
  laboratory: "Лабораторное занятие",
  consultation: "Консультация",
  exam: "Экзамен",
  credit: "Зачёт",
  physical_education: "Физическая культура",
  other: "Занятие",
  unknown: "Занятие",
};

const DAILY_TYPE_LABELS = {
  lecture: "лекция",
  practice: "практика",
  seminar: "семинар",
  laboratory: "лабораторное",
  consultation: "консультация",
  exam: "экзамен",
  credit: "зачёт",
  physical_education: "физкультура",
  other: null,
  unknown: null,
};

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function deepClone(value) {
  return structuredClone(value);
}

function dateUtc(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function diffDays(a, b) {
  const left = dateUtc(a);
  const right = dateUtc(b);
  if (left === null || right === null) return null;
  return Math.round((right - left) / 86400000);
}

function minutes(time) {
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareEvents(a, b) {
  const dateCmp = String(a.event.timing?.date || "").localeCompare(String(b.event.timing?.date || ""));
  if (dateCmp) return dateCmp;
  const aTime = minutes(a.event.timing?.start_time);
  const bTime = minutes(b.event.timing?.start_time);
  if (aTime !== bTime) return (aTime ?? Number.MAX_SAFE_INTEGER) - (bTime ?? Number.MAX_SAFE_INTEGER);
  return a.index - b.index;
}

function normalizeKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function sequenceBucket(typeCode) {
  if (typeCode === "lecture") return "lecture";
  if (["exam", "credit"].includes(typeCode)) return "assessment";
  if (["practice", "seminar", "laboratory", "consultation", "physical_education"].includes(typeCode)) return "class";
  return "other";
}

function typeLabel(event) {
  const code = event.lesson?.type?.code || "other";
  if (code === "credit" && /зач[её]т\s+с\s+оцен/i.test(event.lesson?.type?.raw || "")) {
    return "Зачёт с оценкой";
  }
  return TYPE_LABELS[code] || TYPE_LABELS.other;
}

function controlTitleLabel(event) {
  const label = typeLabel(event);
  return label.toLocaleUpperCase("ru-RU");
}

function formatDateRu(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(date || "");
  return `${Number(match[3])} ${MONTHS_GENITIVE[Number(match[2]) - 1]}`;
}

function formatDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return null;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours} ч ${mins} мин`;
  if (hours) return `${hours} ч`;
  return `${mins} мин`;
}

function academicWeek(date, period) {
  const anchor = period?.week1_start_date || period?.start_date;
  const days = diffDays(anchor, date);
  if (days === null || days < 0) return null;
  return Math.floor(days / 7) + 1;
}

function subgroupLabel(event) {
  const subgroups = event.audience?.subgroups || [];
  if (!subgroups.length) return null;
  return subgroups.map((value) => /^\d+$/.test(String(value)) ? `подгруппа ${value}` : String(value)).join(", ");
}

function buildTitle(event) {
  const discipline = String(event.lesson?.discipline?.normalized || "").trim();
  const upper = discipline.toLocaleUpperCase("ru-RU");
  const code = event.lesson?.type?.code;
  let title;
  if (code === "lecture") title = `ЛЕКЦ. ${upper}`;
  else if (["exam", "credit"].includes(code)) title = `${controlTitleLabel(event)} — ${upper}`;
  else title = discipline;

  const subgroup = subgroupLabel(event);
  if (subgroup) title += ` — ${subgroup}`;
  return title;
}

function buildLocation(event) {
  const locations = event.lesson?.locations || [];
  if (!locations.length) return null;
  const rendered = locations.map((location) => {
    const parts = [];
    if (location.building) parts.push(String(location.building));
    if (location.room) {
      const room = String(location.room);
      parts.push(/ауд/i.test(room) ? room : `ауд. ${room}`);
    }
    if (location.address) parts.push(String(location.address));
    if (!parts.length && location.raw) parts.push(String(location.raw));
    return parts.join(", ");
  }).filter(Boolean);
  return rendered.length ? rendered.join(" / ") : null;
}

function eventIdentity(event) {
  return {
    event_id: event.system?.event_id ?? null,
    date: event.timing?.date ?? null,
    start_time: event.timing?.start_time ?? null,
  };
}

function nextDayEventIdentity(event) {
  return {
    ...eventIdentity(event),
    discipline: event.lesson?.discipline?.normalized ?? null,
    type_code: event.lesson?.type?.code ?? null,
  };
}

function ensureDerived(event) {
  event.derived = {
    academic_week: null,
    sequence: { index: null, total: null, bucket: null },
    next_same_event: null,
    is_last_same_event: false,
    day: {
      index: null,
      total: null,
      remaining: null,
      next_event: null,
      gap_minutes: null,
      overlaps_next: false,
    },
    cycle: null,
    assessment: null,
  };
}

function isAssessment(event) {
  return ["exam", "credit"].includes(event.lesson?.type?.code);
}

function eventMomentKey(event) {
  return `${event.timing?.date || ""}T${event.timing?.start_time || "99:99"}`;
}

function addSequenceMetadata(indexed) {
  const groups = new Map();
  for (const item of indexed) {
    const discipline = normalizeKey(item.event.lesson?.discipline?.normalized);
    const type = item.event.lesson?.type?.code || "unknown";
    const key = `${discipline}\u0000${type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const group of groups.values()) {
    group.sort(compareEvents);
    const total = group.length;
    group.forEach((item, position) => {
      const next = group[position + 1]?.event || null;
      item.event.derived.sequence = {
        index: position + 1,
        total,
        bucket: sequenceBucket(item.event.lesson?.type?.code),
      };
      item.event.derived.next_same_event = next
        ? {
            ...eventIdentity(next),
            gap_days: diffDays(item.event.timing?.date, next.timing?.date),
          }
        : null;
      item.event.derived.is_last_same_event = !next;
    });
  }
}

function addDayMetadata(indexed) {
  const byDate = new Map();
  for (const item of indexed) {
    const date = item.event.timing?.date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  }

  for (const day of byDate.values()) {
    day.sort(compareEvents);
    const total = day.length;
    day.forEach((item, position) => {
      const current = item.event;
      const next = day[position + 1]?.event || null;
      let gapMinutes = null;
      let overlapsNext = false;
      if (next) {
        const currentEnd = minutes(current.timing?.end_time);
        const nextStart = minutes(next.timing?.start_time);
        if (currentEnd !== null && nextStart !== null) {
          gapMinutes = nextStart - currentEnd;
          overlapsNext = gapMinutes < 0;
        }
      }
      current.derived.day = {
        index: position + 1,
        total,
        remaining: total - position - 1,
        next_event: next ? nextDayEventIdentity(next) : null,
        gap_minutes: gapMinutes,
        overlaps_next: overlapsNext,
      };
    });
  }
}

function addCycleMetadata(indexed) {
  const cycles = new Map();
  for (const item of indexed) {
    const cycleId = item.event.lesson?.cycle_id;
    if (!cycleId) continue;
    if (!cycles.has(cycleId)) cycles.set(cycleId, []);
    cycles.get(cycleId).push(item);
  }

  for (const cycleItems of cycles.values()) {
    const dates = [...new Set(cycleItems.map(({ event }) => event.timing?.date).filter(Boolean))].sort();
    const indexByDate = new Map(dates.map((date, index) => [date, index + 1]));
    for (const item of cycleItems) {
      const index = indexByDate.get(item.event.timing?.date);
      item.event.derived.cycle = {
        index,
        total: dates.length,
        is_first: index === 1,
        is_last: index === dates.length,
      };
    }
  }
}

function addAssessmentMetadata(indexed) {
  const byDiscipline = new Map();
  for (const item of indexed) {
    const key = normalizeKey(item.event.lesson?.discipline?.normalized);
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key).push(item);
  }

  for (const items of byDiscipline.values()) {
    items.sort(compareEvents);
    const assessments = items.filter(({ event }) => isAssessment(event));
    for (const item of items) {
      if (isAssessment(item.event)) continue;
      const currentKey = eventMomentKey(item.event);
      const assessmentItem = assessments.find(({ event }) => eventMomentKey(event) > currentKey);
      if (!assessmentItem) continue;
      const assessmentKey = eventMomentKey(assessmentItem.event);
      const remainingLessons = items.filter(({ event }) =>
        !isAssessment(event) && eventMomentKey(event) > currentKey && eventMomentKey(event) < assessmentKey
      ).length;
      item.event.derived.assessment = {
        type_code: assessmentItem.event.lesson?.type?.code,
        label: typeLabel(assessmentItem.event),
        event_id: assessmentItem.event.system?.event_id ?? null,
        date: assessmentItem.event.timing?.date,
        start_time: assessmentItem.event.timing?.start_time,
        remaining_lessons: remainingLessons,
      };
    }
  }
}

function buildDescription(event, schedule, options) {
  const lines = [];
  const sequence = event.derived.sequence;
  if (!isAssessment(event) && sequence?.index && sequence?.total) {
    lines.push(`${typeLabel(event)} · ${sequence.index} из ${sequence.total}`);
  }

  const cycle = event.derived.cycle;
  if (cycle) {
    lines.push(`Цикл · день ${cycle.index} из ${cycle.total}`);
    if (cycle.is_first) lines.push("Начало цикла");
    if (cycle.is_last) lines.push("Завершение цикла");
  }

  if (event.derived.academic_week) lines.push(`Учебная неделя · ${event.derived.academic_week}`);

  if (!isAssessment(event) && event.derived.next_same_event) {
    lines.push(`Следующее занятие по дисциплине: ${formatDateRu(event.derived.next_same_event.date)}`);
    if (Number.isInteger(options.longBreakDays) &&
        event.derived.next_same_event.gap_days >= options.longBreakDays) {
      lines.push(`Перерыв до следующего занятия: ${event.derived.next_same_event.gap_days} дн.`);
    }
  } else if (!isAssessment(event) && event.derived.is_last_same_event) {
    lines.push("Последнее занятие по дисциплине");
  }

  const assessment = event.derived.assessment;
  if (assessment) {
    lines.push(`${assessment.label}: ${formatDateRu(assessment.date)}${assessment.start_time ? `, ${assessment.start_time}` : ""}`);
    lines.push(`До ${assessment.label.toLocaleLowerCase("ru-RU")} осталось занятий: ${assessment.remaining_lessons}`);
  }

  const day = event.derived.day;
  if (day?.index && day?.total) {
    lines.push("");
    lines.push(`Занятие сегодня · ${day.index} из ${day.total}`);
    if (day.next_event) {
      const nextType = DAILY_TYPE_LABELS[day.next_event.type_code] || null;
      lines.push(`Следующее занятие сегодня: ${day.next_event.start_time || "время не указано"} — ${day.next_event.discipline}${nextType ? `, ${nextType}` : ""}`);
      if (day.overlaps_next) {
        lines.push("Перерыв отсутствует: занятия перекрываются");
      } else if (day.gap_minutes !== null) {
        const formatted = formatDuration(day.gap_minutes);
        lines.push(day.gap_minutes === 0
          ? "До начала следующего занятия: сразу после текущего"
          : `До начала следующего занятия: ${formatted}`);
      }
    } else {
      lines.push("Следующее занятие сегодня: нет");
    }
    lines.push(`Осталось занятий сегодня: ${day.remaining}`);
  }

  const subgroup = subgroupLabel(event);
  if (subgroup) {
    lines.push("");
    lines.push(`Вариант: ${subgroup}`);
  }

  const jointGroups = event.lesson?.joint_groups || [];
  if (jointGroups.length) lines.push(`Совместно с группой ${jointGroups.join(", ")}`);

  if (options.includeServiceSignature !== false) {
    lines.push("");
    lines.push(`Группа ${schedule.group} · ${options.serviceName}`);
    lines.push(options.serviceUrl);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function postprocessSchedule(batch, options = {}) {
  if (!batch || !Array.isArray(batch.events) || !batch.schedule) {
    throw new TypeError("schedule-batch with schedule and events is required");
  }

  const result = deepClone(batch);
  const serviceName = options.serviceName || "Календарь КГМУ";
  const serviceUrl = options.serviceUrl || DEFAULT_SERVICE_URL;
  const indexed = result.events.map((event, index) => ({ event, index }));

  for (const { event } of indexed) {
    ensureDerived(event);
    event.derived.academic_week = academicWeek(event.timing?.date, result.schedule.period);
    event.calendar = {
      title: null,
      description: null,
      location: null,
    };
  }

  addSequenceMetadata(indexed);
  addDayMetadata(indexed);
  addCycleMetadata(indexed);
  addAssessmentMetadata(indexed);

  const renderOptions = {
    ...options,
    serviceName,
    serviceUrl,
  };

  for (const { event } of indexed) {
    event.calendar.title = buildTitle(event);
    event.calendar.location = buildLocation(event);
    event.calendar.description = buildDescription(event, result.schedule, renderOptions);
  }

  return result;
}

function shiftDate(date, days) {
  const value = dateUtc(date);
  if (value === null) return null;
  return new Date(value + days * 86400000).toISOString().slice(0, 10);
}

export function buildPromotionEvents(batch, options = {}) {
  const endDate = batch?.schedule?.period?.end_date;
  if (!endDate) return [];
  const serviceName = options.serviceName || "Календарь КГМУ";
  const serviceUrl = options.serviceUrl || DEFAULT_SERVICE_URL;
  const leadDays = Number.isInteger(options.leadDays)
    ? Math.max(10, Math.min(14, options.leadDays))
    : 12;

  const promotions = [
    {
      kind: "promotion",
      code: "period-ending",
      date: shiftDate(endDate, -leadDays),
      all_day: true,
      title: `${serviceName} · календарь скоро завершится`,
      description: `Текущее расписание подходит к концу. Проверить расписание следующего периода можно на сайте:\n${serviceUrl}`,
      url: serviceUrl,
    },
  ];

  if (options.nextPeriodAvailable === true && options.nextPeriodPublishedDate) {
    promotions.push({
      kind: "promotion",
      code: "next-period-ready",
      date: options.nextPeriodPublishedDate,
      all_day: true,
      title: `${serviceName} · следующий календарь доступен`,
      description: `Календарь следующего периода опубликован и доступен на сайте:\n${serviceUrl}`,
      url: serviceUrl,
    });
  }

  return promotions.slice(0, 2);
}

export const POSTPROCESS_SERVICE_URL = DEFAULT_SERVICE_URL;
