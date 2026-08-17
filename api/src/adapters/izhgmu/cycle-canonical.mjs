const FACULTY_NAMES = Object.freeze({
  medicine: 'Лечебный факультет',
  pediatrics: 'Педиатрический факультет',
  dentistry: 'Стоматологический факультет',
});

const CANONICAL_REFERENCE_ROLE = Object.freeze({
  discipline: 'lesson',
  lesson: 'lesson',
  date: 'date',
  time: 'time',
  start_time: 'time',
  end_time: 'time',
  location: 'location',
  department: 'note',
  assessment: 'note',
  note: 'note',
  group_span: 'subgroup',
  subgroup: 'subgroup',
  other: 'other',
});

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeAcademicYear(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2}|\d{2})/);
  if (!match) throw new TypeError('metadata.academicYear must identify one academic year');
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end !== start + 1) throw new TypeError('metadata.academicYear must identify consecutive years');
  return `${start}/${end}`;
}

function normalizeSemester(value) {
  if (value === 'autumn' || Number(value) === 1) return 'autumn';
  if (value === 'spring' || Number(value) === 2) return 'spring';
  if (value === 'summer' || value === 'other') return value;
  throw new TypeError('metadata.semester must be autumn/spring/summer/other or 1/2');
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

function canonicalLocation(value) {
  const raw = optionalString(value);
  return raw ? { raw, building: null, room: null, address: null } : null;
}

function canonicalReferences(series) {
  return (series.references || []).map((reference) => {
    const rawRole = requiredString(reference.role, 'series.references[].role');
    return {
      role: CANONICAL_REFERENCE_ROLE[rawRole] || 'other',
      range: requiredString(reference.range, 'series.references[].range'),
    };
  });
}

export function izhgmuCycleBlockers(parsed) {
  return (parsed?.reviewRequired || []).map((item) => ({
    kind: 'series_review',
    warning: item.warning || item.warnings?.[0] || 'needs_review',
    reference: item.references?.[0]?.range || null,
    discipline: item.discipline || item.disciplineRaw || null,
  }));
}

export function assertIzhgmuCycleComplete(parsed) {
  const blockers = izhgmuCycleBlockers(parsed);
  if (!parsed?.publishable || blockers.length) {
    const error = new Error(`IZH-CYCLE source is incomplete: ${blockers.length} blocker(s)`);
    error.code = 'IZH_CYCLE_INCOMPLETE';
    error.blockers = blockers;
    throw error;
  }
  return parsed;
}

function normalizeInputs({ parsed, metadata, source }) {
  if (parsed?.profile !== 'IZH-CYCLE') throw new TypeError('IZH-CYCLE parsed result is required');
  const group = requiredString(metadata?.groupCode ?? parsed.group, 'metadata.group');
  if (group !== String(parsed.group)) throw new TypeError('metadata group must match parsed group');
  const course = Number(metadata?.course);
  if (!Number.isInteger(course) || course < 1 || course > 10) {
    throw new TypeError('metadata.course must be an integer from 1 to 10');
  }
  return {
    metadata: {
      academicYear: normalizeAcademicYear(metadata?.academicYear),
      semester: normalizeSemester(metadata?.semester),
      facultyCode: requiredString(metadata?.facultyCode, 'metadata.facultyCode'),
      course,
      group,
      stream: optionalString(metadata?.stream),
    },
    source: {
      fileName: requiredString(source?.fileName, 'source.fileName'),
      fileHash: optionalString(source?.fileHash),
    },
  };
}

function eventForDate({ series, date, metadata, source }) {
  const location = canonicalLocation(series.location);
  const lessonType = series.lessonType || { raw: 'практические занятия', code: 'practice' };
  const discipline = requiredString(series.discipline, 'series.discipline');
  return {
    schema_version: '1.0',
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: {
      code: 'izhgmu',
      name: 'Ижевский государственный медицинский университет',
    },
    academic: {
      academic_year: metadata.academicYear,
      semester: metadata.semester,
      faculty_code: metadata.facultyCode,
      faculty_name: FACULTY_NAMES[metadata.facultyCode] || null,
      course: metadata.course,
    },
    audience: {
      group: metadata.group,
      scope: 'whole_group',
      subgroups: [],
      stream: metadata.stream,
    },
    timing: {
      date,
      start_time: requiredString(series.startTime, 'series.startTime'),
      end_time: requiredString(series.endTime, 'series.endTime'),
      all_day: false,
      time_mode: 'floating',
    },
    lesson: {
      discipline: { raw: discipline, normalized: discipline },
      type: { raw: optionalString(lessonType.raw), code: lessonType.code || 'unknown' },
      teachers: [],
      locations: location ? [location] : [],
      source_note: series.assessment ? `Форма контроля: ${series.assessment}` : null,
      cycle_id: null,
      joint_groups: [...(series.jointGroups || [])],
    },
    source: {
      file_name: source.fileName,
      file_hash: source.fileHash,
      sheet: requiredString(series.sourceSheet, 'series.sourceSheet'),
      references: canonicalReferences(series),
      raw_text: optionalString(series.rawSource),
    },
    parse: {
      status: series.status,
      rule_ids: [...new Set((series.ruleIds || []).map(String).map((value) => value.trim()).filter(Boolean))],
      warnings: [...new Set((series.warnings || []).map(String).map((value) => value.trim()).filter(Boolean))],
    },
    derived: emptyDerived(),
    calendar: { title: null, description: null, location: null },
  };
}

function canonicalCandidate({ parsed, metadata, source, parserName }) {
  const normalized = normalizeInputs({ parsed, metadata, source });
  const events = [];
  for (const series of parsed.series || []) {
    if (series.status !== 'ok' || !series.startTime || !series.endTime || !Array.isArray(series.dates)) continue;
    for (const date of [...new Set(series.dates)]) {
      events.push(eventForDate({
        series,
        date,
        metadata: normalized.metadata,
        source: normalized.source,
      }));
    }
  }
  events.sort((left, right) => (
    `${left.timing.date}T${left.timing.start_time}`.localeCompare(`${right.timing.date}T${right.timing.start_time}`)
  ));
  return {
    schema_version: '1.0',
    schedule: {
      university_code: 'izhgmu',
      academic_year: normalized.metadata.academicYear,
      semester: normalized.metadata.semester,
      faculty_code: normalized.metadata.facultyCode,
      course: normalized.metadata.course,
      group: normalized.metadata.group,
      period: {
        start_date: parsed.period.start_date,
        end_date: parsed.period.end_date,
        week1_start_date: parsed.period.week1_start_date,
      },
      source_files: [normalized.source.fileName],
      generated_at: null,
      parser: parserName,
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events,
  };
}

/** QA-only projection of structurally resolved IZH-CYCLE series. */
export function buildIzhgmuCycleQaCandidate(input) {
  return canonicalCandidate({ ...input, parserName: 'izhgmu-cycle-v1-qa-candidate' });
}

/** Production boundary: any unresolved cycle source content fails closed. */
export function buildIzhgmuCycleCanonicalBatch(input) {
  assertIzhgmuCycleComplete(input.parsed);
  return canonicalCandidate({ ...input, parserName: 'izhgmu-cycle-v1' });
}
