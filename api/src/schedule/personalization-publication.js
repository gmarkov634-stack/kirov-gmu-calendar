import { normalizeAcademicYear, scheduleContext } from '../order-context.js';

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedSemester(value) {
  if (value === 'autumn') return 1;
  if (value === 'spring') return 2;
  const number = Number(value);
  return [1, 2].includes(number) ? number : null;
}

function requireCatalog(catalog) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.electives)) {
    throw fail('schedule_personalization_invalid', 'Schedule personalization catalog must be version 1 with electives[]');
  }
  return catalog;
}

function scheduleBinding(schedule) {
  const context = scheduleContext(schedule);
  const scheduleVersionId = String(schedule?.schedule?.schedule_version_id || '').trim();
  const contentFingerprint = String(schedule?.schedule?.content_fingerprint || '').trim();
  if (!scheduleVersionId || !contentFingerprint) {
    throw fail('schedule_personalization_schedule_unversioned', 'Personalization requires a versioned canonical schedule');
  }
  return {
    university: context.university,
    program: context.program,
    course: context.course,
    groupCode: context.groupCode,
    groupId: context.groupId,
    academicYear: normalizeAcademicYear(context.academicYear),
    semester: Number(context.semester),
    scheduleVersionId,
    contentFingerprint,
  };
}

function catalogContext(catalog) {
  return {
    university: String(catalog.university || '').trim(),
    program: String(catalog.program || catalog.facultyCode || '').trim(),
    course: Number(catalog.course),
    groupCode: String(catalog.groupCode || '').trim(),
    academicYear: normalizeAcademicYear(catalog.academicYear),
    semester: normalizedSemester(catalog.semester),
  };
}

function sameContext(binding, catalog) {
  const actual = catalogContext(catalog);
  return actual.university === binding.university
    && actual.program === binding.program
    && actual.course === binding.course
    && actual.groupCode === binding.groupCode
    && actual.academicYear === binding.academicYear
    && actual.semester === binding.semester;
}

export function bindSchedulePersonalizationCatalog(schedule, rawCatalog) {
  const catalog = structuredClone(requireCatalog(rawCatalog));
  const binding = scheduleBinding(schedule);
  if (!sameContext(binding, catalog)) {
    throw fail('schedule_personalization_context_mismatch', 'Personalization catalog context does not match canonical schedule');
  }
  catalog.baseSchedule = binding;
  return catalog;
}

export function schedulePersonalizationMatchesSchedule(schedule, catalog) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.electives) || !catalog.baseSchedule) return false;
  let binding;
  try {
    binding = scheduleBinding(schedule);
  } catch {
    return false;
  }
  return sameContext(binding, catalog)
    && catalog.baseSchedule.university === binding.university
    && catalog.baseSchedule.program === binding.program
    && Number(catalog.baseSchedule.course) === binding.course
    && catalog.baseSchedule.groupCode === binding.groupCode
    && catalog.baseSchedule.groupId === binding.groupId
    && normalizeAcademicYear(catalog.baseSchedule.academicYear) === binding.academicYear
    && Number(catalog.baseSchedule.semester) === binding.semester
    && catalog.baseSchedule.scheduleVersionId === binding.scheduleVersionId
    && catalog.baseSchedule.contentFingerprint === binding.contentFingerprint;
}
