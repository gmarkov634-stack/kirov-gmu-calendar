import { createHash } from "node:crypto";

const PROGRAMS = new Set(["medicine", "pediatrics", "dentistry", "foreign"]);
const TIMED_RE = /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/;
const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const YEAR_RE = /^(20\d{2})\/(\d{2})$/;
const GROUP_RE = /^(\d{3})(и)?$/i;

function fail(message, code = "REVIEWED_BUNDLE_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function eventId(group, event) {
  const digest = createHash("sha1").update([
    group,
    event.title,
    event.start,
    event.end,
    event.location || "",
    event.kind || "lesson",
  ].join("|")).digest("hex").slice(0, 16);
  const date = String(event.start).slice(0, 10);
  const time = event.allDay ? "allday" : String(event.start).slice(11, 16).replace(":", "");
  return `kgmu-${group}-${date}-${time}-${digest}`;
}

function parseAcademicYear(value) {
  const match = clean(value, 20).match(YEAR_RE);
  if (!match) fail("academicYear must use YYYY/YY format");
  const start = Number(match[1]);
  const end = Number(match[2]);
  if ((start + 1) % 100 !== end) fail("academicYear must span exactly one academic year");
  return start;
}

function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function dateWithinPeriod(date, academicStartYear, semester) {
  const min = semester === 1 ? `${academicStartYear}-08-01` : `${academicStartYear + 1}-01-01`;
  const max = semester === 1 ? `${academicStartYear + 1}-01-31` : `${academicStartYear + 1}-07-31`;
  return date >= min && date <= max;
}

function validateTimed(value, field) {
  if (!TIMED_RE.test(value)) fail(`${field} must be YYYY-MM-DDTHH:MM:SS+03:00`);
  const date = value.slice(0, 10);
  if (!validDate(date)) fail(`${field} contains an invalid calendar date`);
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (hour > 23 || minute > 59 || second > 59) fail(`${field} contains an invalid time`);
}

function normalizeGroupCode(value) {
  const code = clean(value, 12).replace(/i$/i, "и");
  if (!GROUP_RE.test(code)) fail(`Invalid group code: ${value}`);
  return code;
}

export function expandGroupRange(value) {
  const text = clean(value, 40).replace(/i/gi, "и");
  const match = text.match(/^(\d{3})(и)?\s*[-–]\s*(\d{3})(и)?$/i);
  if (!match) fail("source.groupRange must look like 231-238 or 101и-109и");
  const first = Number(match[1]);
  const last = Number(match[3]);
  const international = Boolean(match[2] || match[4]);
  if (Boolean(match[2]) !== Boolean(match[4])) fail("Both ends of an international group range must have the same suffix");
  if (last < first || last - first > 30) fail("source.groupRange is invalid or too wide");
  const result = [];
  for (let value = first; value <= last; value += 1) result.push(`${value}${international ? "и" : ""}`);
  return result;
}

function normalizeEvent(raw, { group, academicStartYear, semester }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`Event in group ${group} must be an object`);
  const title = clean(raw.title, 240);
  if (!title) fail(`Event in group ${group} has no title`);
  const location = clean(raw.location, 400);
  const kind = clean(raw.kind || "lesson", 50) || "lesson";
  const allDay = raw.allDay === true;
  const start = clean(raw.start, 40);
  const end = clean(raw.end, 40);

  if (allDay) {
    if (!validDate(start) || !validDate(end)) fail(`All-day event in group ${group} must use YYYY-MM-DD start/end`);
    if (end <= start) fail(`All-day event in group ${group} must have end after start`);
  } else {
    validateTimed(start, `start for ${group}`);
    validateTimed(end, `end for ${group}`);
    if (end <= start) fail(`Timed event in group ${group} must have end after start`);
    const durationMs = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(durationMs) || durationMs > 24 * 60 * 60 * 1000) fail(`Timed event in group ${group} has an implausible duration`);
  }

  const date = start.slice(0, 10);
  if (!dateWithinPeriod(date, academicStartYear, semester)) {
    fail(`Event ${group} ${date} is outside the declared academic period`, "REVIEWED_BUNDLE_PERIOD_INVALID");
  }

  const event = {
    title,
    start,
    end,
    location,
    kind,
    ...(allDay ? { allDay: true } : {}),
    ...(clean(raw.description, 1000) ? { description: clean(raw.description, 1000) } : {}),
    ...(clean(raw.source, 120) ? { source: clean(raw.source, 120) } : {}),
    ...(clean(raw.sourceCell, 40) ? { sourceCell: clean(raw.sourceCell, 40) } : {}),
    ...(clean(raw.sourceRange, 40) ? { sourceRange: clean(raw.sourceRange, 40) } : {}),
  };
  return { ...event, id: eventId(group, event) };
}

function sourceUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    fail("source.url must be a valid official KGMU URL");
  }
  if (url.protocol !== "https:" || !["kirovgma.ru", "www.kirovgma.ru"].includes(url.hostname.toLowerCase())) {
    fail("source.url must point to the official kirovgma.ru domain");
  }
  if (!/\.xlsx$/i.test(url.pathname)) fail("source.url must point to an XLSX file");
  return url.toString();
}

export function validateReviewedBundle(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Reviewed bundle must be a JSON object");
  if (Number(input.version) !== 1) fail("Reviewed bundle version must be 1");
  if (input.university !== "kgmu") fail("Reviewed bundle university must be kgmu");
  const program = clean(input.program, 80);
  if (!PROGRAMS.has(program)) fail("Unsupported KGMU program");
  const course = Number(input.course);
  if (!Number.isInteger(course) || course < 1 || course > 6) fail("course must be an integer from 1 to 6");
  const academicYear = clean(input.academicYear, 20);
  const academicStartYear = parseAcademicYear(academicYear);
  const semester = Number(input.semester);
  if (![1, 2].includes(semester)) fail("semester must be 1 or 2");

  const source = input.source || {};
  const filename = clean(source.filename, 180);
  if (!filename.toLowerCase().endsWith(".xlsx")) fail("source.filename must end with .xlsx");
  const sourceSha256 = clean(source.sha256, 64).toLowerCase();
  if (!SHA_RE.test(sourceSha256)) fail("source.sha256 must be a SHA-256 hex digest");
  const url = sourceUrl(source.url);
  const groupRange = clean(source.groupRange, 40).replace(/i/gi, "и");
  const expectedGroups = expandGroupRange(groupRange);
  if (expectedGroups.some((code) => Number(code.slice(0, 1)) !== course)) fail("source.groupRange does not match course");

  const normalizer = input.normalizer || {};
  if (normalizer.type !== "chatgpt-reviewed") fail("normalizer.type must be chatgpt-reviewed");
  const rulesRevision = clean(normalizer.rulesRevision, 80);
  if (!rulesRevision) fail("normalizer.rulesRevision is required");

  const groups = input.groups;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) fail("groups must be an object keyed by group code");
  const actualGroups = Object.keys(groups).map(normalizeGroupCode).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  const sortedExpected = [...expectedGroups].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  if (JSON.stringify(actualGroups) !== JSON.stringify(sortedExpected)) {
    fail("groups must exactly match source.groupRange", "REVIEWED_BUNDLE_GROUPS_INVALID", { expected: sortedExpected, actual: actualGroups });
  }

  const schedules = [];
  const duplicateKeys = new Set();
  let eventCount = 0;
  for (const group of expectedGroups) {
    const entry = groups[group] || groups[group.replace(/и$/, "i")];
    if (!entry || !Array.isArray(entry.events) || entry.events.length === 0) fail(`Group ${group} must contain at least one event`);
    if (entry.events.length > 2500) fail(`Group ${group} has too many events`);
    const events = entry.events.map((event) => normalizeEvent(event, { group, academicStartYear, semester }));
    for (const event of events) {
      const key = [group, event.title, event.start, event.end, event.location].join("|");
      if (duplicateKeys.has(key)) fail(`Duplicate event detected in group ${group}`, "REVIEWED_BUNDLE_DUPLICATE_EVENT", { group, event });
      duplicateKeys.add(key);
    }
    eventCount += events.length;
    schedules.push({
      version: 1,
      university: "kgmu",
      universityName: "КГМУ",
      program,
      course,
      academicYear,
      semester,
      timezone: "Europe/Moscow",
      group: { id: `kgmu:${program}:${course}:${group}`, code: group, displayName: `Группа ${group}` },
      sources: [{ type: "xlsx", fileName: filename, sha256: sourceSha256, url }],
      normalizer: { type: "chatgpt-reviewed", rulesRevision },
      events,
    });
  }

  return {
    version: 1,
    university: "kgmu",
    program,
    course,
    academicYear,
    semester,
    source: { filename, sha256: sourceSha256, url, groupRange },
    normalizer: { type: "chatgpt-reviewed", rulesRevision },
    schedules,
    qa: {
      status: "PASS",
      validator: "reviewed-json-v1",
      groupCount: schedules.length,
      eventCount,
      duplicateCount: 0,
    },
  };
}

export async function verifyReviewedSource(source, { fetchFn = fetch, maxBytes = 25 * 1024 * 1024 } = {}) {
  const response = await fetchFn(source.url, {
    redirect: "follow",
    headers: { "User-Agent": "medical-calendar-api/1.0 KGMU reviewed-source verifier" },
  });
  if (!response?.ok) fail(`Official XLSX verification returned HTTP ${response?.status || "unknown"}`, "REVIEWED_SOURCE_UNAVAILABLE");
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) fail("Official XLSX exceeds size limit", "REVIEWED_SOURCE_TOO_LARGE");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) fail("Official XLSX exceeds size limit", "REVIEWED_SOURCE_TOO_LARGE");
  const actual = sha256(buffer);
  if (actual !== source.sha256) {
    fail("Reviewed JSON source SHA does not match the current official XLSX", "REVIEWED_SOURCE_SHA_MISMATCH", { expected: source.sha256, actual });
  }
  return { verified: true, sha256: actual, bytes: buffer.length };
}

export async function stageReviewedBundle({ bundle, queue, config, fetchFn = fetch }) {
  const normalized = validateReviewedBundle(bundle);
  const sourceVerification = config?.kgmuReviewedVerifySource === false
    ? { verified: false, skipped: true }
    : await verifyReviewedSource(normalized.source, {
        fetchFn,
        maxBytes: Number(config?.kgmuXlsxMaxBytes || 25 * 1024 * 1024),
      });
  const qa = { ...normalized.qa, sourceVerified: Boolean(sourceVerification.verified) };
  const stored = {
    ...normalized,
    parserType: "REVIEWED_JSON",
    sourceSha256: normalized.source.sha256,
    qa,
    sourceVerification,
  };
  const normalizedKey = await queue.storeNormalized(normalized.source.sha256, stored);
  return { ...stored, normalizedKey };
}

export async function publishStagedReviewedBundle({ queue, scheduleStore, review }) {
  if (!review?.normalizedKey || review?.qa?.status !== "PASS" || review?.parserType !== "REVIEWED_JSON") {
    fail("Reviewed bundle is not publishable", "REVIEW_NOT_PUBLISHABLE");
  }
  const normalized = await queue.getNormalized(review.normalizedKey);
  if (!normalized || normalized.parserType !== "REVIEWED_JSON" || normalized.sourceSha256 !== review.sourceSha256 || normalized.qa?.status !== "PASS") {
    fail("Reviewed normalized result does not match review", "NORMALIZED_RESULT_INVALID");
  }
  if (!Array.isArray(normalized.schedules) || normalized.schedules.length === 0) fail("Reviewed bundle has no schedules", "NORMALIZED_RESULT_INVALID");
  if (typeof scheduleStore?.putScheduleBundle !== "function") fail("Atomic schedule bundle publication is unavailable", "ATOMIC_PUBLICATION_UNAVAILABLE");

  const publishedAt = new Date().toISOString();
  const schedules = normalized.schedules.map((schedule) => ({ ...schedule, parserReviewId: review.reviewId, publishedAt }));
  const result = await scheduleStore.putScheduleBundle(schedules, { sourceSha256: review.sourceSha256 });
  return { groups: schedules.map((schedule) => schedule.group?.code).filter(Boolean), ...result };
}
