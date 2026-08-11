import { normalizeAcademicYear } from "../../order-context.js";

const OFFICIAL_HOSTS = new Set(["kirovgma.ru", "www.kirovgma.ru"]);
const ISO_WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function requireString(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function validOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OFFICIAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validateSourceFile(source) {
  const filename = requireString(source?.filename, "verified-import-source-filename-missing");
  const url = requireString(source?.url, "verified-import-source-url-missing");
  const sha256 = requireString(source?.sha256, "verified-import-source-hash-missing");
  if (!validOfficialUrl(url)) throw new Error(`verified-import-source-not-official:${filename}`);
  if (!SHA256.test(sha256)) throw new Error(`verified-import-source-hash-invalid:${filename}`);
  return { filename, url, sha256: sha256.toLowerCase() };
}

function validateEvent(event, groupCode, seenIds) {
  const id = requireString(event?.id, `verified-import-event-id-missing:${groupCode}`);
  if (seenIds.has(id)) throw new Error(`verified-import-duplicate-event-id:${groupCode}:${id}`);
  seenIds.add(id);

  requireString(event?.title, `verified-import-event-title-missing:${groupCode}:${id}`);
  const start = requireString(event?.start, `verified-import-event-start-missing:${groupCode}:${id}`);
  const end = requireString(event?.end, `verified-import-event-end-missing:${groupCode}:${id}`);
  if (!ISO_WITH_ZONE.test(start) || !ISO_WITH_ZONE.test(end)) {
    throw new Error(`verified-import-event-timezone-missing:${groupCode}:${id}`);
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`verified-import-event-time-invalid:${groupCode}:${id}`);
  }
  if (event?.sourceType !== "official-xlsx") {
    throw new Error(`verified-import-event-source-untrusted:${groupCode}:${id}`);
  }
}

function sourceRegistry(bundle) {
  if (!Array.isArray(bundle?.sourceFiles) || !bundle.sourceFiles.length) {
    throw new Error("verified-import-source-registry-missing");
  }
  const registry = new Map();
  for (const raw of bundle.sourceFiles) {
    const source = validateSourceFile(raw);
    if (registry.has(source.filename)) throw new Error(`verified-import-duplicate-source:${source.filename}`);
    registry.set(source.filename, source);
  }
  return registry;
}

function validateSchedule(schedule, { expectedAcademicYear, expectedSemester, registry, seenGroups }) {
  if (schedule?.university !== "kgmu") throw new Error("verified-import-wrong-university");
  const program = requireString(schedule?.program, "verified-import-program-missing");
  const course = Number(schedule?.course);
  if (!Number.isInteger(course) || course < 1 || course > 6) throw new Error("verified-import-course-invalid");
  const groupCode = requireString(schedule?.group?.code, "verified-import-group-missing");
  const groupId = requireString(schedule?.group?.id, `verified-import-group-id-missing:${groupCode}`);
  if (groupId !== `kgmu:${program}:${course}:${groupCode}`) {
    throw new Error(`verified-import-group-id-mismatch:${groupCode}`);
  }
  if (seenGroups.has(groupId)) throw new Error(`verified-import-duplicate-group:${groupCode}`);
  seenGroups.add(groupId);

  const academicYear = normalizeAcademicYear(schedule?.academicYear);
  const semester = Number(schedule?.semester);
  if (academicYear !== expectedAcademicYear || semester !== expectedSemester) {
    throw new Error(`verified-import-period-mismatch:${groupCode}`);
  }
  if (schedule?.timezone !== "Europe/Moscow") throw new Error(`verified-import-timezone-mismatch:${groupCode}`);

  const sources = Array.isArray(schedule?.sources) ? schedule.sources : [];
  const official = sources.find((source) => source?.type === "official-xlsx");
  if (!official) throw new Error(`verified-import-official-source-missing:${groupCode}`);
  const sourceFile = requireString(official?.sourceFile || official?.filename, `verified-import-source-file-missing:${groupCode}`);
  const registered = registry.get(sourceFile);
  if (!registered) throw new Error(`verified-import-source-not-registered:${groupCode}:${sourceFile}`);
  if (String(official?.sha256 || "").toLowerCase() !== registered.sha256) {
    throw new Error(`verified-import-source-hash-mismatch:${groupCode}:${sourceFile}`);
  }
  if (String(official?.url || "") !== registered.url) {
    throw new Error(`verified-import-source-url-mismatch:${groupCode}:${sourceFile}`);
  }

  if (!Array.isArray(schedule?.events) || !schedule.events.length) {
    throw new Error(`verified-import-empty-schedule:${groupCode}`);
  }
  const seenIds = new Set();
  for (const event of schedule.events) validateEvent(event, groupCode, seenIds);

  return {
    ...schedule,
    academicYear,
    semester,
    qa: {
      ...(schedule.qa || {}),
      archiveReferenceOnly: false,
      commercialTargetPeriod: true,
      passed: true,
      verificationSource: "verified-import",
    },
    publishable: true,
  };
}

export function validateKgmuVerifiedImport(bundle, { academicYear, semester } = {}) {
  if (!bundle || bundle.version !== 1 || bundle.university !== "kgmu") {
    throw new Error("verified-import-bundle-invalid");
  }
  if (bundle?.review?.status !== "approved") throw new Error("verified-import-not-approved");
  const approvedAt = requireString(bundle?.review?.approvedAt, "verified-import-approved-at-missing");
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error("verified-import-approved-at-invalid");

  const expectedAcademicYear = normalizeAcademicYear(academicYear);
  const expectedSemester = Number(semester);
  if (!expectedAcademicYear || ![1, 2].includes(expectedSemester)) {
    throw new Error("verified-import-target-period-required");
  }
  if (normalizeAcademicYear(bundle.academicYear) !== expectedAcademicYear || Number(bundle.semester) !== expectedSemester) {
    throw new Error("verified-import-bundle-period-mismatch");
  }

  const registry = sourceRegistry(bundle);
  if (!Array.isArray(bundle.schedules) || !bundle.schedules.length) {
    throw new Error("verified-import-schedules-missing");
  }
  const seenGroups = new Set();
  const schedules = bundle.schedules.map((schedule) => validateSchedule(schedule, {
    expectedAcademicYear,
    expectedSemester,
    registry,
    seenGroups,
  }));

  return {
    version: 1,
    university: "kgmu",
    academicYear: expectedAcademicYear,
    semester: expectedSemester,
    approvedAt: new Date(approvedAt).toISOString(),
    reviewMethod: String(bundle?.review?.method || "semi-automatic").trim() || "semi-automatic",
    sourceFileCount: registry.size,
    scheduleCount: schedules.length,
    schedules,
  };
}
