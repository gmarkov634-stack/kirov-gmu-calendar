const HOLIDAYS_2026 = new Set(["2026-05-01", "2026-05-09", "2026-06-12"]);
const WEEKDAYS = { ПОНЕДЕЛЬНИК: 1, ВТОРНИК: 2, СРЕДА: 3, ЧЕТВЕРГ: 4, ПЯТНИЦА: 5 };

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function stableHash(value) {
  let hash = 5381;
  for (const character of String(value)) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return (hash >>> 0).toString(36);
}

function rangeDates(start, end, { weekday = null, includeSaturday = false } = {}) {
  const dates = [];
  const cursor = new Date(Date.UTC(2026, start.month - 1, start.day));
  const last = new Date(Date.UTC(2026, end.month - 1, end.day));
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    const value = isoDate(cursor);
    const allowedDay = weekday == null
      ? day !== 0 && (includeSaturday || day !== 6)
      : day === weekday;
    if (allowedDay && !HOLIDAYS_2026.has(value)) dates.push(value);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function parseDateExpression(value, weekday = null) {
  const normalized = value.replace(/зач[её]т[^,;]*/gi, "").replace(/с\s+\d{2}[.:]\d{2}[^,;]*/gi, "");
  const dates = [];
  for (const match of normalized.matchAll(/(\d{2})\.(\d{2})(?:\s*-\s*(\d{2})\.(\d{2}))?/g)) {
    const start = { day: Number(match[1]), month: Number(match[2]) };
    const end = match[3] ? { day: Number(match[3]), month: Number(match[4]) } : start;
    dates.push(...rangeDates(start, end, { weekday }));
  }
  return [...new Set(dates)].sort();
}

function russianSection(text, marker) {
  const index = String(text || "").lastIndexOf(marker);
  return index >= 0 ? String(text).slice(index) : String(text || "");
}

export function parseFourthCourseLectures(text) {
  const lines = russianSection(text, "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ").split(/\r?\n/);
  let weekday = null;
  const records = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const joined = current.lines.join(" ").replace(/\s+/g, " ").trim();
    const countMarker = joined.match(/^(.+?),\s*\d+\s+лекц(?:ия|ии|ий):\s*(.+)$/i);
    if (countMarker) {
      const tail = countMarker[2];
      const addressSplit = tail.split(/\s+[–-]\s+/);
      const dates = parseDateExpression(addressSplit[0], current.weekday);
      if (dates.length) records.push({
        discipline: countMarker[1].trim(),
        startTime: current.startTime,
        endTime: current.endTime,
        dates,
        location: addressSplit.slice(1).join(" - ").trim(),
        kind: "lecture",
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (WEEKDAYS[line]) {
      flush();
      weekday = WEEKDAYS[line];
      continue;
    }
    const match = rawLine.match(/^\s*\*?(\d{2})[.:](\d{2})-(\d{2})[.:](\d{2})\s+(.+)$/);
    if (match) {
      flush();
      current = {
        startTime: `${match[1]}:${match[2]}`,
        endTime: `${match[3]}:${match[4]}`,
        weekday: rawLine.trimStart().startsWith("*") ? null : weekday,
        lines: [match[5]],
      };
    } else if (current && line) {
      current.lines.push(line);
    }
  }
  flush();
  return records;
}

function blockDiscipline(lines) {
  return lines
    .map((line) => line.slice(0, 31).trim())
    .filter((value) => value && !/^(Дисциплина|\d+\s*цикл)/i.test(value))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockTimes(lines) {
  const values = [];
  for (const line of lines) {
    for (const match of line.slice(27, 43).matchAll(/(\d{2})[.:](\d{2})/g)) values.push(`${match[1]}:${match[2]}`);
  }
  return values.length >= 2 ? { startTime: values[0], endTime: values.at(-1) } : null;
}

function groupColumn(lines, groupCode) {
  const start = groupCode === "485" ? 43 : 78;
  const end = groupCode === "485" ? 78 : undefined;
  return lines.map((line) => line.slice(start, end).trim()).filter(Boolean).join(" ");
}

export function parseFourthCourseCycles(text) {
  const section = russianSection(text, "РАСПИСАНИЕ ЦИКЛОВЫХ ЗАНЯТИЙ").replace(/\f/g, "\n\n");
  const records = { "485": [], "486": [] };
  for (const block of section.split(/\n\s*\n+/)) {
    const lines = block.split(/\r?\n/);
    const discipline = blockDiscipline(lines);
    const times = blockTimes(lines);
    if (!discipline || !times || /Дисциплина|К\.дн/i.test(discipline)) continue;
    for (const groupCode of ["485", "486"]) {
      const column = groupColumn(lines, groupCode);
      const dates = parseDateExpression(column);
      if (!dates.length) continue;
      const kind = /лекц/i.test(column) ? "lecture" : "cycle";
      records[groupCode].push({ discipline, ...times, dates, kind, location: "" });
    }
  }
  return records;
}

function scheduleFor(groupCode, lectureRecords, cycleRecords, sources) {
  const records = [...lectureRecords, ...cycleRecords];
  const events = records.flatMap((record) => {
    const disciplineHash = stableHash(record.discipline);
    return record.dates.map((date) => ({
      id: `omgmu-${groupCode}-${date}-${record.startTime.replace(":", "")}-${record.kind}-${disciplineHash}`,
      title: `${record.kind === "lecture" ? "Лекция" : "Цикл"}: ${record.discipline}`,
      start: `${date}T${record.startTime}:00+06:00`,
      end: `${date}T${record.endTime}:00+06:00`,
      location: record.location || "",
      sourceType: record.kind,
    }));
  });
  events.sort((a, b) => a.start.localeCompare(b.start));
  return {
    version: 1,
    university: "omgmu",
    universityName: "ОмГМУ",
    program: "medicine-international",
    course: 4,
    stream: null,
    academicYear: "2025-2026",
    semester: 2,
    timezone: "Asia/Omsk",
    group: {
      id: `omgmu:medicine-international:4:${groupCode}`,
      code: groupCode,
      displayName: `Группа ${groupCode}`,
    },
    sources,
    events,
  };
}

export function buildFourthCourseSchedules(lecturesText, cyclesText, { lectureUrl = null, cyclesUrl = null } = {}) {
  const lectures = parseFourthCourseLectures(lecturesText);
  const cycles = parseFourthCourseCycles(cyclesText);
  const sources = [
    lectureUrl ? { url: lectureUrl, part: "lectures" } : null,
    cyclesUrl ? { url: cyclesUrl, part: "cycles" } : null,
  ].filter(Boolean);
  return {
    "485": scheduleFor("485", lectures, cycles["485"], sources),
    "486": scheduleFor("486", lectures, cycles["486"], sources),
  };
}
