function issue(severity, code, group, event, message) {
  return {
    severity,
    code,
    group,
    eventId: event?.id ?? null,
    message,
  };
}

function eventKey(event) {
  return [event.start, event.end, String(event.title || "").trim(), String(event.location || "").trim()].join("|");
}

function validDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export function inspectSchedule(schedule) {
  const group = String(schedule?.group?.code || "unknown");
  const events = Array.isArray(schedule?.events) ? schedule.events : [];
  const issues = [];
  const seenIds = new Set();
  const seenEvents = new Set();

  if (!schedule?.group?.code) issues.push(issue("error", "missing-group-code", group, null, "Отсутствует код группы"));
  if (!events.length) issues.push(issue("error", "empty-schedule", group, null, "Расписание не содержит событий"));

  const sorted = [...events].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  for (const event of sorted) {
    const title = String(event?.title || "").trim();
    const id = String(event?.id || "").trim();

    if (!id) issues.push(issue("error", "missing-id", group, event, "У события отсутствует id"));
    else if (seenIds.has(id)) issues.push(issue("error", "duplicate-id", group, event, `Повторяется id ${id}`));
    else seenIds.add(id);

    if (!title) issues.push(issue("error", "empty-title", group, event, "Пустое название занятия"));
    if (title.length > 220) issues.push(issue("warning", "long-title", group, event, `Подозрительно длинное название: ${title.length} символов`));
    if (/РАСПИСАНИЕ|ГРУППА|ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА/i.test(title)) {
      issues.push(issue("warning", "header-in-title", group, event, "В название занятия попал заголовок таблицы"));
    }

    if (!validDate(event?.start) || !validDate(event?.end)) {
      issues.push(issue("error", "invalid-date", group, event, "Некорректная дата или время"));
      continue;
    }

    const start = new Date(event.start);
    const end = new Date(event.end);
    const durationMinutes = (end - start) / 60000;
    if (durationMinutes <= 0) issues.push(issue("error", "invalid-duration", group, event, "Окончание не позже начала"));
    if (durationMinutes > 600) issues.push(issue("warning", "long-duration", group, event, `Продолжительность ${durationMinutes} минут`));
    if (start.getUTCFullYear() !== 2026 || end.getUTCFullYear() !== 2026) {
      issues.push(issue("error", "unexpected-year", group, event, "Событие находится вне 2026 года"));
    }

    const key = eventKey(event);
    if (seenEvents.has(key)) issues.push(issue("error", "duplicate-event", group, event, "Полный дубль события"));
    else seenEvents.add(key);
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!validDate(previous?.end) || !validDate(current?.start)) continue;
    const previousEnd = new Date(previous.end);
    const currentStart = new Date(current.start);
    if (currentStart < previousEnd && eventKey(previous) !== eventKey(current)) {
      issues.push(issue("warning", "time-overlap", group, current, `Пересечение с ${previous.id || "предыдущим событием"}`));
    }
  }

  return {
    group,
    eventCount: events.length,
    errors: issues.filter((item) => item.severity === "error"),
    warnings: issues.filter((item) => item.severity === "warning"),
  };
}

export function buildQualityReport(schedules) {
  const groups = schedules.map(inspectSchedule);
  return {
    generatedAt: new Date().toISOString(),
    scheduleCount: groups.length,
    eventCount: groups.reduce((sum, item) => sum + item.eventCount, 0),
    errorCount: groups.reduce((sum, item) => sum + item.errors.length, 0),
    warningCount: groups.reduce((sum, item) => sum + item.warnings.length, 0),
    groups,
  };
}
