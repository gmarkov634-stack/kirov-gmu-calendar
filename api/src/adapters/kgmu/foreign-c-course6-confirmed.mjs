import { createHash } from "node:crypto";

const MONTHS = new Map([
  ["январ", 1], ["january", 1], ["jan", 1],
  ["феврал", 2], ["february", 2], ["feb", 2],
  ["март", 3], ["march", 3], ["mar", 3],
  ["апрел", 4], ["april", 4], ["apr", 4],
  ["май", 5], ["мая", 5], ["may", 5],
  ["июн", 6], ["june", 6], ["jun", 6],
  ["июл", 7], ["july", 7], ["jul", 7],
  ["август", 8], ["august", 8], ["aug", 8],
  ["сентябр", 9], ["september", 9], ["sep", 9],
  ["октябр", 10], ["october", 10], ["oct", 10],
  ["ноябр", 11], ["november", 11], ["nov", 11],
  ["декабр", 12], ["december", 12], ["dec", 12],
]);

const GIA = /^(?:ГИА|Final State Examination)$/i;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*-?\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}

function monthNumber(value) {
  const text = clean(value).toLowerCase();
  for (const [name, number] of MONTHS) if (text.includes(name)) return number;
  return null;
}

function rowMap(sheet) {
  const rows = new Map();
  for (const cell of sheet?.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  for (const cells of rows.values()) cells.sort((a, b) => a.col - b.col);
  return rows;
}

function eventYear(parsed) {
  const schedule = parsed?.schedules?.[0];
  const academicYear = String(schedule?.academicYear || "").match(/^(20\d{2})\/(\d{2})$/);
  if (!academicYear) return null;
  const start = Number(academicYear[1]);
  return Number(schedule.semester) === 1 ? start : start + 1;
}

function dateColumns(sheet, year) {
  const rows = rowMap(sheet);
  const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
    const day = Number(cell.value);
    return Number.isInteger(day) && day >= 1 && day <= 31;
  }).length >= 10)?.[0];
  if (!dateRow) return { rows, dates: new Map(), dateRow: null };
  const monthRows = [...rows.entries()]
    .filter(([row]) => row < dateRow && row >= dateRow - 3)
    .sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) return { rows, dates: new Map(), dateRow };
  const starts = (rows.get(monthRow) || [])
    .map((cell) => ({ col: cell.col, month: monthNumber(cell.value) }))
    .filter((item) => item.month)
    .sort((a, b) => a.col - b.col);
  const dates = new Map();
  for (const cell of rows.get(dateRow) || []) {
    const day = Number(cell.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const month = [...starts].reverse().find((item) => item.col <= cell.col)?.month;
    if (month) dates.set(cell.col, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return { rows, dates, dateRow };
}

function nextDay(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function stableId(group, date, start, title, source) {
  const digest = createHash("sha1").update([group, date, start, title, source].join("|")).digest("hex").slice(0, 12);
  return `kgmu-${group}-${date}-${String(start).replace(":", "")}-${digest}`;
}

function isoTime(value) {
  return String(value || "").slice(11, 16);
}

function timedEvent({ group, date, time, title, kind, location = "", source, description = null }) {
  return {
    id: stableId(group, date, time.start, title, source),
    group,
    title,
    discipline: title,
    kind,
    start: `${date}T${time.start}:00+03:00`,
    end: `${date}T${time.end}:00+03:00`,
    location,
    assessment: kind === "exam" ? "Экзамен" : null,
    description,
    sourceType: "main_grid",
    source,
    sourceCell: source,
    sourceExplicit: true,
  };
}

function allDayEvent({ group, start, end, title, kind, source, description = null }) {
  return {
    id: stableId(group, start, "allday", title, source),
    group,
    title,
    discipline: title,
    kind,
    allDay: true,
    start,
    end,
    location: "",
    assessment: null,
    description,
    sourceType: "main_grid",
    source,
    sourceCell: source,
    sourceExplicit: true,
  };
}

function oncologyEvents(parsed) {
  const events = [];
  const unresolved = [];
  for (const block of parsed.qa?.ambiguousOncologyLongDays || []) {
    const normal = block.normalTime;
    const long = block.exceptionalTime;
    if (!normal || !long || !Array.isArray(block.dates) || block.dates.length < 3) {
      unresolved.push(block);
      continue;
    }
    block.dates.forEach((date, index) => {
      const time = index < 3 ? long : normal;
      events.push(timedEvent({
        group: block.group,
        date,
        time,
        title: "Онкология, лучевая терапия",
        kind: "practice",
        source: `${block.sourceCell}:oncology:${index + 1}`,
        description: index < 3
          ? "В исходном расписании указано: три дня цикла 08:00–12:40; конкретные дни выбираются группой с преподавателем. Для календаря технически поставлены первые три дня цикла."
          : null,
      }));
    });
  }
  return { events, unresolved };
}

function electiveEvents(parsed) {
  const events = [];
  const seen = new Set();
  for (const block of parsed.qa?.ambiguousElectiveAssignments || []) {
    for (const date of block.dates || []) {
      const key = `${block.group}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(allDayEvent({
        group: block.group,
        start: date,
        end: nextDay(date),
        title: "ЭЛЕКТИВНАЯ ДИСЦИПЛИНА",
        kind: "elective",
        source: `${block.markers?.[0]?.cell || block.startDate}:elective:${date}`,
        description: "Конкретная дисциплина выбирается студентом позднее; в исходном расписании на этом этапе вариант не определён.",
      }));
    }
  }
  return events;
}

function giaPeriods(workbook, parsed) {
  const year = eventYear(parsed);
  if (!year) return { events: [], unresolved: [{ reason: "event-year-unresolved" }] };
  const result = [];
  const unresolved = [];
  const expectedGroups = new Set((parsed.schedules || []).map((schedule) => schedule.group.code));

  for (const sheet of workbook?.sheets || []) {
    const { rows, dates } = dateColumns(sheet, year);
    if (!dates.size) continue;
    const styled = new Map((sheet.styledCells || []).map((cell) => [`${cell.row}|${cell.col}`, cell]));
    for (const [row, cells] of rows) {
      const group = cells.map((cell) => groupCode(cell.value)).find(Boolean);
      if (!expectedGroups.has(group)) continue;
      const markers = cells.filter((cell) => GIA.test(clean(cell.value)));
      for (const marker of markers) {
        const fillId = styled.get(`${row}|${marker.col}`)?.fillId;
        if (!fillId) {
          unresolved.push({ group, cell: marker.ref, reason: "gia-fill-not-preserved" });
          continue;
        }
        const cols = [...dates.keys()]
          .filter((col) => styled.get(`${row}|${col}`)?.fillId === fillId)
          .sort((a, b) => a - b);
        const markerIndex = cols.indexOf(marker.col);
        if (markerIndex < 0) {
          unresolved.push({ group, cell: marker.ref, reason: "gia-marker-not-in-date-axis" });
          continue;
        }
        const run = [marker.col];
        for (let i = markerIndex + 1; i < cols.length && cols[i] === run[run.length - 1] + 1; i += 1) run.push(cols[i]);
        for (let i = markerIndex - 1; i >= 0 && cols[i] === run[0] - 1; i -= 1) run.unshift(cols[i]);
        const first = dates.get(run[0]);
        const last = dates.get(run[run.length - 1]);
        if (!first || !last) {
          unresolved.push({ group, cell: marker.ref, reason: "gia-date-range-unresolved" });
          continue;
        }
        result.push(allDayEvent({
          group,
          start: first,
          end: nextDay(last),
          title: "ГИА",
          kind: "state_exam",
          source: marker.ref,
        }));
      }
    }
  }

  const unique = new Map(result.map((event) => [`${event.group}|${event.start}|${event.end}`, event]));
  return { events: [...unique.values()], unresolved };
}

function examEvents(parsed, extraPracticeEvents) {
  const result = [];
  const unresolved = [];
  const byGroup = new Map();
  for (const schedule of parsed.schedules || []) {
    byGroup.set(schedule.group.code, [
      ...(schedule.events || []).filter((event) => event.kind === "practice"),
      ...extraPracticeEvents.filter((event) => event.group === schedule.group.code),
    ].sort((a, b) => a.start.localeCompare(b.start)));
  }

  for (const item of parsed.qa?.examInterruptions || []) {
    const practices = byGroup.get(item.group) || [];
    const previous = [...practices].reverse().find((event) => event.start.slice(0, 10) < item.date);
    if (!previous) {
      unresolved.push({ ...item, reason: "preceding-cycle-not-found" });
      continue;
    }
    const start = isoTime(previous.start);
    const end = isoTime(previous.end);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      unresolved.push({ ...item, reason: "preceding-cycle-time-not-found" });
      continue;
    }
    const discipline = previous.discipline || previous.title;
    result.push(timedEvent({
      group: item.group,
      date: item.date,
      time: { start, end },
      title: `ЭКЗАМЕН — ${discipline}`,
      kind: "exam",
      location: previous.location || "",
      source: item.cell,
    }));
  }
  return { events: result, unresolved };
}

function duplicateIds(events) {
  const seen = new Set();
  const duplicates = [];
  for (const event of events) {
    const key = [event.group, event.start, event.end, event.title, event.location || ""].join("|");
    if (seen.has(key)) duplicates.push(event.id);
    seen.add(key);
  }
  return duplicates;
}

function timedOverlapReport(events) {
  const allowed = [];
  const blocking = [];
  const byDay = new Map();
  for (const event of events.filter((item) => !item.allDay)) {
    const key = `${event.group}|${event.start.slice(0, 10)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  for (const [key, dayEvents] of byDay) {
    const [group, date] = key.split("|");
    const sorted = [...dayEvents].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (Date.parse(sorted[j].start) >= Date.parse(sorted[i].end)) break;
        const conflict = { group, date, event1: sorted[i].id, event2: sorted[j].id, title1: sorted[i].title, title2: sorted[j].title };
        if (sorted[i].sourceExplicit && sorted[j].sourceExplicit) allowed.push(conflict);
        else blocking.push(conflict);
      }
    }
  }
  return { allowed, blocking };
}

export function applyConfirmedCourse6Rules(workbook, parsed) {
  const oncology = oncologyEvents(parsed);
  const elective = electiveEvents(parsed);
  const gia = giaPeriods(workbook, parsed);
  const exams = examEvents(parsed, oncology.events);
  const extras = [...oncology.events, ...elective, ...gia.events, ...exams.events];

  const schedules = (parsed.schedules || []).map((schedule) => {
    const group = schedule.group.code;
    const groupExtras = extras.filter((event) => event.group === group).map(({ group: _group, ...event }) => event);
    const events = [...(schedule.events || []), ...groupExtras].sort((a, b) => {
      const byStart = String(a.start).localeCompare(String(b.start));
      return byStart || String(a.title).localeCompare(String(b.title));
    });
    return {
      ...schedule,
      parserQa: {
        ...schedule.parserQa,
        oncologyAmbiguities: 0,
        electiveAmbiguities: 0,
        normalizedOncologyDays: oncology.events.filter((event) => event.group === group).length,
        electiveAllDayEvents: elective.filter((event) => event.group === group).length,
        giaPeriods: gia.events.filter((event) => event.group === group).length,
        examEvents: exams.events.filter((event) => event.group === group).length,
      },
      events,
    };
  });

  const allEvents = schedules.flatMap((schedule) => schedule.events.map((event) => ({ ...event, group: schedule.group.code })));
  const duplicates = duplicateIds(allEvents);
  const overlaps = timedOverlapReport(allEvents);
  const unresolved = [...oncology.unresolved, ...gia.unresolved, ...exams.unresolved];
  const blocked = (parsed.qa?.unhandledBlocks || []).length
    || (parsed.qa?.missingTimes || []).length
    || (parsed.qa?.mirrorSemanticRisks || []).length
    || unresolved.length
    || duplicates.length
    || overlaps.blocking.length;

  const qa = {
    ...parsed.qa,
    status: blocked ? "REVIEW_REQUIRED" : "PASS",
    passed: !blocked,
    ambiguousOncologyLongDays: [],
    ambiguousElectiveAssignments: [],
    normalizedOncologyDays: oncology.events.length,
    normalizedOncologyLongDays: oncology.events.filter((event) => /12:40:00/.test(event.end)).length,
    electiveAllDayEvents: elective.length,
    giaEvents: gia.events.length,
    examEvents: exams.events.length,
    unresolvedConfirmedRules: unresolved,
    duplicateCount: duplicates.length,
    duplicates,
    allowedOverlaps: overlaps.allowed,
    remainingOverlaps: overlaps.blocking,
    overlapCount: overlaps.allowed.length + overlaps.blocking.length,
    eventCount: allEvents.length,
    groupCounts: Object.fromEntries(schedules.map((schedule) => [schedule.group.code, schedule.events.length])),
  };

  return { ...parsed, schedules, qa };
}
