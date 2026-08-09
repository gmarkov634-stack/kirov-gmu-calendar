const DAYS = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
};

const HOLIDAYS_2026 = new Set(["2026-05-01", "2026-05-09", "2026-06-12"]);
const TIME_RANGE = /(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/;
const DATE_RANGE = /(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})/;
const DATE_SINGLE = /(?<!\d)(\d{2})\.(\d{2})(?!\d)/g;

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datesForWeekday(start, end, weekday, year = 2026) {
  const result = [];
  const cursor = new Date(Date.UTC(year, start.month - 1, start.day));
  const last = new Date(Date.UTC(year, end.month - 1, end.day));
  while (cursor <= last) {
    const value = isoDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (cursor.getUTCDay() === weekday && !HOLIDAYS_2026.has(value)) result.push(value);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function explicitDates(text, weekday, year = 2026) {
  const range = text.match(DATE_RANGE);
  if (range) {
    return datesForWeekday(
      { day: Number(range[1]), month: Number(range[2]) },
      { day: Number(range[3]), month: Number(range[4]) },
      weekday,
      year,
    );
  }
  return [...text.matchAll(DATE_SINGLE)]
    .map((match) => isoDate(year, Number(match[2]), Number(match[1])))
    .filter((value) => !HOLIDAYS_2026.has(value));
}

function russianSection(text) {
  const marker = "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ";
  const index = String(text || "").lastIndexOf(marker);
  return index >= 0 ? String(text).slice(index) : String(text || "");
}

export function detectGroupColumns(text) {
  const lines = russianSection(text).split(/\r?\n/);
  let best = [];
  let bestLineLength = 0;

  for (const line of lines) {
    const matches = [...line.matchAll(/(?<!\d)(\d{3,4})(?!\d)/g)]
      .filter((match) => !["2025", "2026"].includes(match[1]));
    if (matches.length > best.length) {
      best = matches;
      bestLineLength = line.length;
    }
  }

  if (best.length < 2) return [];
  return best.map((match, index) => ({
    code: match[1],
    start: match.index,
    end: best[index + 1]?.index ?? bestLineLength + 30,
  }));
}

function cleanTitle(value) {
  return value
    .replace(TIME_RANGE, " ")
    .replace(DATE_RANGE, " ")
    .replace(/\b\d+\s*(?:зан\.|з\.|лекц(?:ий|ии)?|cl\.)\s*:?/gi, " ")
    .replace(/\b(?:ауд\.|корпус|здание)\b.*$/i, " ")
    .replace(/[,:;]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCell(buffer, { groupCode, weekday, course, stream }) {
  const text = buffer.join(" ").replace(/\s+/g, " ").trim();
  const time = text.match(TIME_RANGE);
  if (!time || !weekday) return [];
  const dates = explicitDates(text, weekday);
  if (!dates.length) return [];
  const title = cleanTitle(text);
  if (!title || /^\d/.test(title)) return [];
  const startTime = `${String(time[1]).padStart(2, "0")}:${time[2]}`;
  const endTime = `${String(time[3]).padStart(2, "0")}:${time[4]}`;
  return dates.map((date) => ({
    id: `omgmu-${groupCode}-${date}-${startTime.replace(":", "")}`,
    title,
    start: `${date}T${startTime}:00+06:00`,
    end: `${date}T${endTime}:00+06:00`,
    location: "",
    sourceType: "weekly-table",
    course,
    stream,
  }));
}

export function parseWeeklyTable(text, { course, stream = null } = {}) {
  const section = russianSection(text).replace(/\f/g, "\n");
  const columns = detectGroupColumns(section);
  const byGroup = Object.fromEntries(columns.map((column) => [column.code, []]));
  const buffers = Object.fromEntries(columns.map((column) => [column.code, []]));
  let weekday = null;

  const flush = (code) => {
    if (!buffers[code].length) return;
    byGroup[code].push(...parseCell(buffers[code], { groupCode: code, weekday, course, stream }));
    buffers[code] = [];
  };

  for (const rawLine of section.split(/\r?\n/)) {
    const normalized = rawLine.toLowerCase().trim();
    const dayName = Object.keys(DAYS).find((day) => normalized.includes(day));
    if (dayName) {
      for (const code of Object.keys(buffers)) flush(code);
      weekday = DAYS[dayName];
      continue;
    }
    if (!weekday || !rawLine.trim()) continue;

    for (const column of columns) {
      const cell = rawLine.slice(column.start, column.end).trim();
      if (!cell) continue;
      if (TIME_RANGE.test(cell) && buffers[column.code].some((line) => TIME_RANGE.test(line))) flush(column.code);
      buffers[column.code].push(cell);
      if ((DATE_RANGE.test(cell) || [...cell.matchAll(DATE_SINGLE)].length > 1) && TIME_RANGE.test(buffers[column.code].join(" "))) {
        flush(column.code);
      }
    }
  }
  for (const code of Object.keys(buffers)) flush(code);
  return byGroup;
}

export function buildWeeklySchedules(text, { course, stream = null, sourceUrl = null } = {}) {
  const parsed = parseWeeklyTable(text, { course, stream });
  return Object.entries(parsed).map(([code, events]) => ({
    version: 1,
    university: "omgmu",
    universityName: "ОмГМУ",
    program: "medicine-international",
    course,
    stream,
    academicYear: "2025-2026",
    semester: 2,
    timezone: "Asia/Omsk",
    group: {
      id: `omgmu:medicine-international:${course}:${stream ? `stream-${stream}:` : ""}${code}`,
      code,
      displayName: `Группа ${code}`,
    },
    sources: sourceUrl ? [{ url: sourceUrl, part: "combined" }] : [],
    events,
  }));
}
