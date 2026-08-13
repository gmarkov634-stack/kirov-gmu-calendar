const UNIVERSITY_DEFAULTS = {
  kgmu: { name: "КГМУ", timezone: "Europe/Moscow" },
  omgmu: { name: "ОмГМУ", timezone: "Asia/Omsk" },
  pgmu: { name: "ПГМУ", timezone: "Asia/Yekaterinburg" },
};

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAcademicYear(value) {
  const match = String(value || "").match(/(\d{4})\D+(\d{2,4})/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || end !== start + 1) return null;
  return `${start}/${end}`;
}

export function academicYearStorageSegment(value) {
  const normalized = normalizeAcademicYear(value);
  return normalized ? normalized.replace("/", "-") : null;
}

export function scheduleContext(schedule = {}, requestedUniversity) {
  const university = stringOrNull(schedule.university) || stringOrNull(requestedUniversity) || "kgmu";
  const defaults = UNIVERSITY_DEFAULTS[university] || {};
  const program = stringOrNull(schedule.program) || stringOrNull(schedule.faculty);
  const stream = stringOrNull(schedule.stream);
  const groupCode = stringOrNull(schedule.group?.code) || stringOrNull(schedule.groupCode) || stringOrNull(schedule.group);
  const groupId = stringOrNull(schedule.group?.id) || [university, program, schedule.course, stream && `stream-${stream}`, groupCode]
    .filter(Boolean)
    .join(":");
  const groupDisplayName = stringOrNull(schedule.group?.displayName) || (groupCode ? `Группа ${groupCode}` : null);
  const rawAcademicYear = stringOrNull(schedule.academicYear);

  return {
    university,
    universityName: stringOrNull(schedule.universityName) || defaults.name || university.toUpperCase(),
    program,
    course: Number(schedule.course),
    stream,
    groupCode,
    groupId,
    groupDisplayName,
    timezone: stringOrNull(schedule.timezone) || defaults.timezone || "UTC",
    academicYear: normalizeAcademicYear(rawAcademicYear) || rawAcademicYear,
    semester: Number(schedule.semester),
  };
}

export function scheduleFlatStorageKey(schedule = {}) {
  const context = scheduleContext(schedule);
  if (!context.university || !context.program || !Number.isInteger(context.course) || !context.groupId) {
    throw new Error("Incomplete schedule context");
  }
  return `schedules/${context.university}/${context.program}/${context.course}/${encodeURIComponent(context.groupId)}.json`;
}

export function scheduleStorageKey(schedule = {}) {
  const context = scheduleContext(schedule);
  const flat = scheduleFlatStorageKey(context);
  const year = academicYearStorageSegment(context.academicYear);
  const semester = Number(context.semester);
  if (!year || ![1, 2].includes(semester)) return flat;
  const base = `schedules/${context.university}/${context.program}/${context.course}`;
  return `${base}/${year}/semester-${semester}/${encodeURIComponent(context.groupId)}.json`;
}
