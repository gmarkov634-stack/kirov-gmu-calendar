import { normalizeAcademicYear } from "./order-context.js";

function validSemester(value) {
  const semester = Number(value);
  return [1, 2].includes(semester) ? semester : null;
}

export function kgmuArchiveTestPeriod(config) {
  if (config?.kgmuArchiveTest?.enabled !== true) return null;
  if (config?.yookassaTestMode !== true) return null;
  const academicYear = normalizeAcademicYear(config.kgmuArchiveTest.academicYear);
  const semester = validSemester(config.kgmuArchiveTest.semester);
  if (!academicYear || !semester) return null;
  return { academicYear, semester };
}

export function kgmuArchiveTestActive(config) {
  return Boolean(kgmuArchiveTestPeriod(config));
}

export function scheduleRequestForActiveMode(context, config) {
  const period = kgmuArchiveTestPeriod(config);
  if (!period || context?.university !== "kgmu") return context;
  const explicitAcademicYear = normalizeAcademicYear(context?.academicYear);
  const explicitSemester = validSemester(context?.semester);
  if (explicitAcademicYear || explicitSemester) return context;
  return { ...context, ...period };
}

export function isKgmuArchiveTestSchedule(config, context) {
  const period = kgmuArchiveTestPeriod(config);
  if (!period || context?.university !== "kgmu") return false;
  return normalizeAcademicYear(context.academicYear) === period.academicYear &&
    Number(context.semester) === period.semester;
}
