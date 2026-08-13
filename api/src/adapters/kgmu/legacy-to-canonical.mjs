const KIND_MAP = new Map([
  ["lecture", "lecture"],
  ["practice", "practice"],
  ["physical_education", "physical_education"],
  ["project_defense", "other"],
]);

function fail(message, code = "LEGACY_CANONICAL_MIGRATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function academicYear(value) {
  const match = clean(value).match(/^(20\d{2})\/(\d{2})$/);
  if (!match) fail("Legacy academicYear must use YYYY/YY");
  return `${match[1]}/20${match[2]}`;
}

function semester(value) {
  if (Number(value) === 1) return "autumn";
  if (Number(value) === 2) return "spring";
  fail("Legacy semester must be 1 or 2");
}

function facultyName(program) {
  const names = {
    medicine: "Лечебный факультет",
    pediatrics: "Педиатрический факультет",
    dentistry: "Стоматологический факультет",
    foreign: "Факультет иностранных обучающихся",
  };
  return names[program] || null;
}

function dateFromLegacy(value) {
  const text = clean(value);
  const match = text.match(/^(20\d{2}-\d{2}-\d{2})(?:T(\d{2}:\d{2}):\d{2}\+03:00)?$/);
  if (!match) fail(`Unsupported legacy date/time: ${text}`);
  return { date: match[1], time: match[2] || null };
}

function canonicalDiscipline(event) {
  const title = clean(event.title);
  if (!title) fail("Legacy event has no title");
  if (event.kind === "lecture") return title.replace(/^ЛЕКЦ\.?\s*/iu, "").trim() || title;
  return title;
}

function location(raw) {
  const value = clean(raw);
  if (!value) return [];
  return [{ raw: value, building: null, room: null, address: null }];
}

function references(event) {
  const range = clean(event.sourceRange || event.sourceCell);
  return range ? [{ role: "lesson", range }] : [];
}

function emptyDerived() {
  return {
    academic_week: null,
    sequence: { index: null, total: null, bucket: null },
    next_same_event: null,
    is_last_same_event: false,
    day: {
      index: null,
      total: null,
      remaining: null,
      next_event: null,
      gap_minutes: null,
      overlaps_next: false,
    },
    cycle: null,
    assessment: null,
  };
}

function convertEvent(event, context) {
  const typeCode = KIND_MAP.get(clean(event.kind));
  if (!typeCode) fail(`Unsupported reviewed legacy kind: ${event.kind}`);
  const start = dateFromLegacy(event.start);
  const end = dateFromLegacy(event.end);
  const allDay = event.allDay === true;
  if (allDay && (start.time || end.time)) fail("Legacy all-day event unexpectedly contains a time");
  if (!allDay && (!start.time || !end.time)) fail("Timed legacy event must contain start/end times");
  if (start.date !== end.date && !allDay) fail("Canonical migration does not accept overnight legacy events");

  const discipline = canonicalDiscipline(event);
  return {
    schema_version: "1.0",
    system: { event_id: null, schedule_version_id: null, fingerprint: null },
    university: { code: "kgmu", name: "Кировский ГМУ" },
    academic: {
      academic_year: context.academicYear,
      semester: context.semester,
      faculty_code: context.program,
      faculty_name: facultyName(context.program),
      course: context.course,
    },
    audience: { group: context.group, scope: "whole_group", subgroups: [], stream: null },
    timing: {
      date: start.date,
      start_time: allDay ? null : start.time,
      end_time: allDay ? null : end.time,
      all_day: allDay,
      time_mode: "floating",
    },
    lesson: {
      discipline: { raw: discipline, normalized: discipline },
      type: { raw: clean(event.kind) || null, code: typeCode },
      teachers: [],
      locations: location(event.location),
      source_note: clean(event.description) || null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: context.source.filename,
      file_hash: `sha256:${context.source.sha256}`,
      sheet: null,
      references: references(event),
      raw_text: null,
    },
    parse: {
      status: "ok",
      rule_ids: ["legacy-reviewed-migration-v1"],
      warnings: [],
    },
    derived: emptyDerived(),
    calendar: { title: null, description: null, location: null },
  };
}

export function legacyReviewedGroupToCanonicalPackage(input, { group, week1StartDate }) {
  if (!input || typeof input !== "object") fail("Legacy reviewed bundle is required");
  if (input.university !== "kgmu") fail("Only KGMU legacy reviewed bundles are supported");
  const groupCode = clean(group);
  const entry = input.groups?.[groupCode];
  if (!entry || !Array.isArray(entry.events) || entry.events.length === 0) fail(`Legacy group ${groupCode} is missing`);
  const week1 = dateFromLegacy(week1StartDate);
  if (week1.time) fail("week1StartDate must be a date");
  const normalizedYear = academicYear(input.academicYear);
  const normalizedSemester = semester(input.semester);
  const course = Number(input.course);
  const program = clean(input.program);
  const source = input.source || {};
  if (!clean(source.filename) || !/^[a-f0-9]{64}$/i.test(clean(source.sha256))) fail("Legacy source metadata is incomplete");

  const context = {
    group: groupCode,
    academicYear: normalizedYear,
    semester: normalizedSemester,
    course,
    program,
    source,
  };
  const events = entry.events.map((event) => convertEvent(event, context));
  const dates = events.map((event) => event.timing.date).sort();
  if (week1.date > dates[0]) fail("week1StartDate cannot be after the first event");

  return {
    format: "canonical-reviewed/v1",
    rules_revision: `${clean(input.normalizer?.rulesRevision) || "legacy"}+canonical-migration-v1`,
    batches: [{
      schema_version: "1.0",
      schedule: {
        university_code: "kgmu",
        academic_year: normalizedYear,
        semester: normalizedSemester,
        faculty_code: program,
        course,
        group: groupCode,
        period: {
          start_date: dates[0],
          end_date: dates.at(-1),
          week1_start_date: week1.date,
        },
        source_files: [clean(source.filename)],
        generated_at: null,
        parser: "legacy-reviewed-migration-v1",
      },
      events,
    }],
  };
}

export const LEGACY_KIND_MAP = Object.freeze(Object.fromEntries(KIND_MAP));
