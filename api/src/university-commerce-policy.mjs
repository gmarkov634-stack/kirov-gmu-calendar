import { hasUniversity } from "./universities/registry.mjs";

const DEFAULT_POLICY = Object.freeze({
  catalogEnabled: true,
  salesEnabled: true,
  trialsEnabled: true,
  scopes: null,
});

const UNIVERSITY_POLICIES = Object.freeze({
  izhgmu: Object.freeze({
    catalogEnabled: true,
    salesEnabled: false,
    trialsEnabled: false,
    scopes: Object.freeze([
      Object.freeze({ program: "medicine", courses: Object.freeze([1, 2, 3]) }),
    ]),
  }),
});

function normalizedUniversity(value) {
  return String(value || "").trim().toLowerCase();
}

export function universityCommercePolicy(university) {
  const id = normalizedUniversity(university);
  if (!hasUniversity(id)) return null;
  return UNIVERSITY_POLICIES[id] || DEFAULT_POLICY;
}

export function universityCatalogEnabled(university) {
  return universityCommercePolicy(university)?.catalogEnabled === true;
}

export function universitySalesEnabled(university) {
  return universityCommercePolicy(university)?.salesEnabled === true;
}

export function universityTrialsEnabled(university) {
  return universityCommercePolicy(university)?.trialsEnabled === true;
}

export function catalogContextAllowed({ university, program, course }) {
  const policy = universityCommercePolicy(university);
  if (!policy?.catalogEnabled) return false;
  if (!Array.isArray(policy.scopes)) return true;

  const normalizedProgram = String(program || "").trim();
  const normalizedCourse = Number(course);
  return policy.scopes.some((scope) =>
    scope.program === normalizedProgram &&
    Number.isInteger(normalizedCourse) &&
    scope.courses.includes(normalizedCourse));
}

export function filterCatalogAvailability(university, programs = []) {
  const policy = universityCommercePolicy(university);
  if (!policy?.catalogEnabled) return [];
  if (!Array.isArray(policy.scopes)) return programs;

  return programs.flatMap((item) => {
    const scope = policy.scopes.find((candidate) => candidate.program === item?.program);
    if (!scope) return [];
    const courses = Array.isArray(item?.courses)
      ? item.courses.filter((course) => scope.courses.includes(Number(course)))
      : [];
    return courses.length ? [{ ...item, courses }] : [];
  });
}
