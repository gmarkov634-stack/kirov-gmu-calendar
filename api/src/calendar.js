function escapeIcs(value = "") {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function utcStamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line) {
  const chunks = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 73) {
    let index = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = Buffer.byteLength(char, "utf8");
      if (bytes + size > 73) break;
      bytes += size;
      index += char.length;
    }
    chunks.push(rest.slice(0, index));
    rest = ` ${rest.slice(index)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

const UNIVERSITY_NAMES = {
  kgmu: "КГМУ",
  omgmu: "ОмГМУ",
  pgmu: "ПГМУ",
};

function calendarIdentity(schedule) {
  const university = schedule.university || "kgmu";
  const universityName = schedule.universityName || UNIVERSITY_NAMES[university] || university.toUpperCase();
  const timezone = schedule.timezone || (university === "omgmu" ? "Asia/Omsk" : university === "pgmu" ? "Asia/Yekaterinburg" : "Europe/Moscow");
  const groupCode = schedule.group?.code || schedule.groupCode || schedule.group;
  const groupName = schedule.group?.displayName || `Группа ${groupCode}`;
  return { university, universityName, timezone, groupCode, groupName };
}

export function buildCalendar(schedule, publicBaseUrl = "") {
  const generatedAt = utcStamp(new Date());
  const identity = calendarIdentity(schedule);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Календарь ${escapeIcs(identity.universityName)}//Расписание//RU`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(`${identity.universityName} · ${identity.groupName}`)}`,
    `X-WR-TIMEZONE:${escapeIcs(identity.timezone)}`,
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const event of schedule.events || []) {
    const description = [
      event.description,
      "Составлено по официальному расписанию. Переносы, согласованные группой с преподавателем, не отображаются.",
      publicBaseUrl && `Расписание: ${publicBaseUrl}`,
    ].filter(Boolean).join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(event.id)}@${identity.university}-calendar`,
      `DTSTAMP:${generatedAt}`,
      `DTSTART:${utcStamp(event.start)}`,
      `DTEND:${utcStamp(event.end)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `LOCATION:${escapeIcs(event.location || "")}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
