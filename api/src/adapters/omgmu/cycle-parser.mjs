const RANGE = /(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})\s*\((лекции|циклы)\)/i;
const TIME = /(\d{2})[.:](\d{2})\s*-/;
const TIME_END = /^\s{20,}(\d{2})[.:](\d{2})\s*$/;
const HOLIDAYS_2026 = new Set(["2026-05-01", "2026-05-09", "2026-06-12"]);

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateRange(start, end, year = 2026) {
  const result = [];
  const cursor = new Date(Date.UTC(year, start.month - 1, start.day));
  const last = new Date(Date.UTC(year, end.month - 1, end.day));
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    const value = isoDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (weekday !== 0 && weekday !== 6 && !HOLIDAYS_2026.has(value)) result.push(value);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function russianSection(text) {
  const marker = "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ";
  const index = text.lastIndexOf(marker);
  return index >= 0 ? text.slice(index) : text;
}

function blockDiscipline(lines) {
  return lines
    .map((line) => line.slice(0, 30).trim())
    .filter((value) => value && !/^(Дисциплина|Время|К\.дн\.)$/i.test(value))
    .filter((value) => !/^\d{2}[.:]\d{2}/.test(value))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBlock(block) {
  const lines = block.split(/\r?\n/);
  const discipline = blockDiscipline(lines);
  if (!discipline) return [];

  const starts = [];
  const ends = [];
  const ranges = [];
  for (const line of lines) {
    const start = line.match(TIME);
    if (start) starts.push(`${start[1]}:${start[2]}`);
    const end = line.match(TIME_END);
    if (end) ends.push(`${end[1]}:${end[2]}`);
    const range = line.match(RANGE);
    if (range) {
      ranges.push({
        start: { day: Number(range[1]), month: Number(range[2]) },
        end: { day: Number(range[3]), month: Number(range[4]) },
        kind: range[5].toLowerCase() === "лекции" ? "lecture" : "cycle",
      });
    }
  }
  return ranges.map((range, index) => ({
    discipline,
    kind: range.kind,
    startTime: starts[index] || null,
    endTime: ends[index] || null,
    dates: dateRange(range.start, range.end),
  })).filter((item) => item.startTime && item.endTime && item.dates.length);
}

export function parseFifthCourseBlocks(text) {
  const section = russianSection(String(text || "")).replace(/\f/g, "\n\n");
  return section
    .split(/\n\s*\n+/)
    .flatMap(parseBlock)
    .filter((item) => !/Дисциплина/i.test(item.discipline));
}

export function buildFifthCourseSchedule(text, { sourceUrl = null } = {}) {
  const blocks = parseFifthCourseBlocks(text);
  const events = blocks.flatMap((block) => block.dates.map((date) => ({
    id: `omgmu-585-${date}-${block.startTime.replace(":", "")}-${block.kind}`,
    title: `${block.kind === "lecture" ? "Лекция" : "Цикл"}: ${block.discipline}`,
    start: `${date}T${block.startTime}:00+06:00`,
    end: `${date}T${block.endTime}:00+06:00`,
    location: "",
    sourceType: block.kind,
  })));
  return {
    version: 1,
    university: "omgmu",
    universityName: "ОмГМУ",
    program: "medicine-international",
    course: 5,
    stream: null,
    academicYear: "2025-2026",
    semester: 2,
    timezone: "Asia/Omsk",
    group: {
      id: "omgmu:medicine-international:5:585",
      code: "585",
      displayName: "Группа 585",
    },
    sources: sourceUrl ? [{ url: sourceUrl, part: "combined" }] : [],
    events,
  };
}
