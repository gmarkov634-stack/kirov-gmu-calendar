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

function rowsOf(sheet) {
  const rows = new Map();
  for (const cell of sheet.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  for (const cells of rows.values()) cells.sort((a, b) => a.col - b.col);
  return rows;
}

function eventYear(parsed) {
  const schedule = parsed?.schedules?.[0];
  const match = String(schedule?.academicYear || "").match(/^(20\d{2})\/(\d{2})$/);
  if (!match) return null;
  const start = Number(match[1]);
  return Number(schedule.semester) === 1 ? start : start + 1;
}

function dateColumns(sheet, year) {
  const rows = rowsOf(sheet);
  const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
    const day = Number(cell.value);
    return Number.isInteger(day) && day >= 1 && day <= 31;
  }).length >= 10)?.[0];
  if (!dateRow) return new Map();
  const monthRows = [...rows.entries()].filter(([row]) => row < dateRow && row >= dateRow - 3).sort((a, b) => b[0] - a[0]);
  const monthRow = monthRows.find(([, cells]) => cells.some((cell) => monthNumber(cell.value)))?.[0];
  if (!monthRow) return new Map();
  const starts = (rows.get(monthRow) || []).map((cell) => ({ col: cell.col, month: monthNumber(cell.value) })).filter((item) => item.month).sort((a, b) => a.col - b.col);
  const dates = new Map();
  for (const cell of rows.get(dateRow) || []) {
    const day = Number(cell.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const month = [...starts].reverse().find((item) => item.col <= cell.col)?.month;
    if (month) dates.set(cell.col, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function nextDay(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function stableId(group, start, end, source) {
  const digest = createHash("sha1").update([group, start, end, "ГИА", source].join("|")).digest("hex").slice(0, 12);
  return `kgmu-${group}-${start}-allday-${digest}`;
}

function sharedGiaBlocks(workbook, parsed) {
  const year = eventYear(parsed);
  const visibleGroups = new Set((parsed.schedules || []).map((schedule) => schedule.group.code));
  const blocks = [];
  const unresolved = [];
  if (!year) return { blocks, unresolved: [{ reason: "shared-gia-event-year-unresolved" }] };

  for (const sheet of workbook?.sheets || []) {
    const rows = rowsOf(sheet);
    const dates = dateColumns(sheet, year);
    for (const cell of sheet.cells || []) {
      if (!/^(?:ГИА|Final State Examination)$/i.test(clean(cell.value))) continue;
      const merge = (sheet.merges || []).find((item) => item.startRow <= cell.row && cell.row <= item.endRow && item.startCol <= cell.col && cell.col <= item.endCol);
      if (!merge || merge.endRow <= merge.startRow) continue;
      const targetGroups = [];
      for (let row = merge.startRow; row <= merge.endRow; row += 1) {
        const group = (rows.get(row) || []).map((item) => groupCode(item.value)).find(Boolean);
        if (visibleGroups.has(group)) targetGroups.push(group);
      }
      const start = dates.get(merge.startCol);
      const last = dates.get(merge.endCol);
      if (!start || !last || !targetGroups.length) {
        unresolved.push({ cell: cell.ref, merge: merge.ref, targetGroups, start: start || null, last: last || null, reason: "shared-gia-geometry-unresolved" });
        continue;
      }
      blocks.push({ source: cell.ref, merge: merge.ref, groups: [...new Set(targetGroups)], start, end: nextDay(last) });
    }
  }
  return { blocks, unresolved };
}

export function applySharedGiaRule(workbook, parsed) {
  const shared = sharedGiaBlocks(workbook, parsed);
  if (!shared.blocks.length && !shared.unresolved.length) return parsed;

  const schedules = (parsed.schedules || []).map((schedule) => {
    const group = schedule.group.code;
    const blocks = shared.blocks.filter((block) => block.groups.includes(group));
    if (!blocks.length) return schedule;
    const events = (schedule.events || []).filter((event) => event.kind !== "state_exam");
    for (const block of blocks) {
      events.push({
        id: stableId(group, block.start, block.end, block.source),
        title: "ГИА",
        discipline: "ГИА",
        kind: "state_exam",
        allDay: true,
        start: block.start,
        end: block.end,
        location: "",
        assessment: null,
        sourceType: "main_grid",
        source: block.source,
        sourceCell: block.source,
        sourceExplicit: true,
      });
    }
    events.sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title)));
    return {
      ...schedule,
      parserQa: { ...schedule.parserQa, giaPeriods: blocks.length },
      events,
    };
  });

  const eventCount = schedules.reduce((sum, schedule) => sum + schedule.events.length, 0);
  const giaEvents = schedules.reduce((sum, schedule) => sum + schedule.events.filter((event) => event.kind === "state_exam").length, 0);
  const unresolvedConfirmedRules = [...(parsed.qa?.unresolvedConfirmedRules || []), ...shared.unresolved];
  const blocked = unresolvedConfirmedRules.length > 0;
  return {
    ...parsed,
    schedules,
    qa: {
      ...parsed.qa,
      status: blocked ? "REVIEW_REQUIRED" : parsed.qa.status,
      passed: blocked ? false : parsed.qa.passed,
      giaEvents,
      sharedGiaBlocks: shared.blocks,
      unresolvedConfirmedRules,
      eventCount,
      groupCounts: Object.fromEntries(schedules.map((schedule) => [schedule.group.code, schedule.events.length])),
    },
  };
}
