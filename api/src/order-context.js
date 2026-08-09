const UNIVERSITY_DEFAULTS = {
  kgmu: { name: "КГМУ", timezone: "Europe/Moscow" },
  omgmu: { name: "ОмГМУ", timezone: "Asia/Omsk" },
  pgmu: { name: "ПГМУ", timezone: "Asia/Yekaterinburg" },
};

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    academicYear: stringOrNull(schedule.academicYear),
    semester: Number(schedule.semester),
  };
}

export function scheduleStorageKey(schedule = {}) {
  const context = scheduleContext(schedule);
  if (!context.university || !context.program || !Number.isInteger(context.course) || !context.groupId) {
    throw new Error("Incomplete schedule context");
  }
  return `schedules/${context.university}/${context.program}/${context.course}/${encodeURIComponent(context.groupId)}.json`;
}
