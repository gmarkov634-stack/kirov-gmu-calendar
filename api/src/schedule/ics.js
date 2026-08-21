const UNIVERSITY_NAMES = {
  kgmu: "КГМУ",
  omgmu: "ОмГМУ",
  pgmu: "ПГМУ",
  ugmu: "УГМУ",
};

function escapeText(value = "") {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function dateStamp(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError(`Invalid calendar date: ${value}`);
  return `${match[1]}${match[2]}${match[3]}`;
}

function floatingStamp(date, time) {
  const datePart = dateStamp(date);
  const match = String(time || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new TypeError(`Invalid floating calendar time: ${time}`);
  return `${datePart}T${match[1]}${match[2]}00`;
}

function utcStamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid UTC calendar timestamp: ${value}`);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function nextDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError(`Invalid all-day calendar date: ${value}`);
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp + 86400000).toISOString().slice(0, 10);
}

function takeUtf8Prefix(value, byteLimit) {
  let bytes = 0;
  let chars = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > byteLimit) break;
    bytes += size;
    chars += char.length;
  }
  if (chars === 0 && value.length) throw new Error("Unable to fold ICS line safely");
  return chars;
}

function foldLine(line) {
  const physical = [];
  let remaining = String(line);
  let first = true;
  while (remaining.length) {
    const prefix = first ? "" : " ";
    const contentLimit = 75 - Buffer.byteLength(prefix, "utf8");
    if (Buffer.byteLength(remaining, "utf8") <= contentLimit) {
      physical.push(`${prefix}${remaining}`);
      break;
    }
    const cut = takeUtf8Prefix(remaining, contentLimit);
    physical.push(`${prefix}${remaining.slice(0, cut)}`);
    remaining = remaining.slice(cut);
    first = false;
  }
  return physical.join("\r\n");
}

function universityName(code) {
  return UNIVERSITY_NAMES[code] || String(code || "").toUpperCase();
}

function uidDomain(code) {
  return `${String(code || "calendar").toLowerCase()}-calendar`;
}

function requireVersionedBatch(batch) {
  if (!batch?.schedule || !Array.isArray(batch.events)) {
    throw new TypeError("versioned schedule-batch with schedule and events is required");
  }
  if (!batch.schedule.schedule_version_id) {
    throw new TypeError("schedule.schedule_version_id is required before ICS generation");
  }
  if (!batch.schedule.version_created_at) {
    throw new TypeError("schedule.version_created_at is required before ICS generation");
  }
  for (const [index, event] of batch.events.entries()) {
    if (!event?.system?.event_id) throw new TypeError(`events[${index}].system.event_id is required before ICS generation`);
    if (!Number.isInteger(event?.system?.revision) || event.system.revision < 1) {
      throw new TypeError(`events[${index}].system.revision must be a positive integer before ICS generation`);
    }
    if (!event?.system?.created_at || !event?.system?.updated_at) {
      throw new TypeError(`events[${index}] version timestamps are required before ICS generation`);
    }
    if (!event?.calendar?.title) throw new TypeError(`events[${index}].calendar.title is required before ICS generation`);
    if (event?.timing?.time_mode !== "floating") {
      throw new TypeError(`events[${index}].timing.time_mode must be floating`);
    }
  }
}

function eventLines(event, code) {
  const timing = event.timing || {};
  const allDay = timing.all_day === true;
  const startLine = allDay
    ? `DTSTART;VALUE=DATE:${dateStamp(timing.date)}`
    : `DTSTART:${floatingStamp(timing.date, timing.start_time)}`;
  const endLine = allDay
    ? `DTEND;VALUE=DATE:${dateStamp(nextDate(timing.date))}`
    : `DTEND:${floatingStamp(timing.date, timing.end_time)}`;
  const revision = event.system.revision;
  const sequence = Math.max(0, revision - 1);

  return [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.system.event_id)}@${uidDomain(code)}`,
    `DTSTAMP:${utcStamp(event.system.updated_at)}`,
    `CREATED:${utcStamp(event.system.created_at)}`,
    `LAST-MODIFIED:${utcStamp(event.system.updated_at)}`,
    `SEQUENCE:${sequence}`,
    startLine,
    endLine,
    `SUMMARY:${escapeText(event.calendar.title)}`,
    `LOCATION:${escapeText(event.calendar.location || "")}`,
    `DESCRIPTION:${escapeText(event.calendar.description || "")}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
  ];
}

export function buildScheduleIcs(batch, options = {}) {
  requireVersionedBatch(batch);
  const schedule = batch.schedule;
  const code = schedule.university_code;
  const name = options.universityName || universityName(code);
  const groupName = options.groupName || `Группа ${schedule.group}`;
  const refreshInterval = options.refreshInterval || "PT6H";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Календарь ${escapeText(name)}//Расписание//RU`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${name} · ${groupName}`)}`,
    `X-PUBLISHED-TTL:${refreshInterval}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refreshInterval}`,
    `X-SCHEDULE-VERSION:${escapeText(schedule.schedule_version_id)}`,
    `X-SCHEDULE-CONTENT-FINGERPRINT:${escapeText(schedule.content_fingerprint || "")}`,
  ];

  const orderedEvents = [...batch.events].sort((a, b) => {
    const aKey = `${a.timing?.date || ""}T${a.timing?.start_time || ""}|${a.system?.event_id || ""}`;
    const bKey = `${b.timing?.date || ""}T${b.timing?.start_time || ""}|${b.system?.event_id || ""}`;
    return aKey.localeCompare(bKey);
  });
  for (const event of orderedEvents) lines.push(...eventLines(event, code));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export { escapeText as escapeIcsText, foldLine as foldIcsLine, floatingStamp as floatingIcsStamp };
