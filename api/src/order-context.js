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
    faculty: stringOrNull(schedule.faculty) || program,
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

export function publicGroupCode(record = {}) {
  return stringOrNull(record.groupCode) || stringOrNull(record.group?.code) || stringOrNull(record.group);
}

export function legacyCompatibleContext(record = {}) {
  const context = scheduleContext(record, record.university);
  return {
    ...record,
    ...context,
    group: publicGroupCode(record) || context.groupCode,
  };
}
