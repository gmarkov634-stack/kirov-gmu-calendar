const UNIVERSITY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const ENTITY_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function requiredString(value, field, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${field} is required`);
}

export function normalizeUniversity(value) {
  return typeof value === "string" && UNIVERSITY_ID.test(value) ? value : null;
}

export function buildGroupId({ university, program, course, stream, groupCode }) {
  const parts = [university, program, String(course)];
  if (stream) parts.push(`stream-${stream}`);
  parts.push(String(groupCode));
  return parts.join(":");
}

export function validateNormalizedSchedule(schedule) {
  const errors = [];
  if (!schedule || typeof schedule !== "object") return ["schedule must be an object"];
  if (schedule.version !== 1) errors.push("version must be 1");
  if (!normalizeUniversity(schedule.university)) errors.push("university is invalid");
  requiredString(schedule.program, "program", errors);
  if (!Number.isInteger(schedule.course) || schedule.course < 1 || schedule.course > 9) errors.push("course is invalid");
  if (schedule.stream != null && (typeof schedule.stream !== "string" || !schedule.stream.trim())) errors.push("stream is invalid");
  requiredString(schedule.timezone, "timezone", errors);
  requiredString(schedule.academicYear, "academicYear", errors);
  if (!Number.isInteger(schedule.semester) || schedule.semester < 1 || schedule.semester > 2) errors.push("semester is invalid");

  const group = schedule.group;
  if (!group || typeof group !== "object") errors.push("group is required");
  else {
    requiredString(group.id, "group.id", errors);
    requiredString(group.code, "group.code", errors);
    requiredString(group.displayName, "group.displayName", errors);
    if (typeof group.id === "string" && !ENTITY_ID.test(group.id)) errors.push("group.id is invalid");
  }

  if (!Array.isArray(schedule.sources) || schedule.sources.length === 0) errors.push("sources must contain at least one source");
  if (!Array.isArray(schedule.events)) errors.push("events must be an array");
  else {
    schedule.events.forEach((event, index) => {
      if (!event || typeof event !== "object") return errors.push(`events[${index}] must be an object`);
      requiredString(event.id, `events[${index}].id`, errors);
      requiredString(event.title, `events[${index}].title`, errors);
      requiredString(event.start, `events[${index}].start`, errors);
      requiredString(event.end, `events[${index}].end`, errors);
      if (event.start && !Number.isFinite(Date.parse(event.start))) errors.push(`events[${index}].start is invalid`);
      if (event.end && !Number.isFinite(Date.parse(event.end))) errors.push(`events[${index}].end is invalid`);
    });
  }
  return errors;
}

export function assertNormalizedSchedule(schedule) {
  const errors = validateNormalizedSchedule(schedule);
  if (errors.length) {
    const error = new Error(`Invalid normalized schedule: ${errors.join("; ")}`);
    error.code = "invalid_normalized_schedule";
    error.details = errors;
    throw error;
  }
  return schedule;
}
