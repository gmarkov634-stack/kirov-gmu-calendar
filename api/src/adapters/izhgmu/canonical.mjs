const FACULTY_NAMES = Object.freeze({
  medicine: 'Лечебный факультет',
  pediatrics: 'Педиатрический факультет',
  dentistry: 'Стоматологический факультет',
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

function academicYear(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2}|\d{2})/);
  if (!match) throw new TypeError('metadata.academicYear must identify one academic year');
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end !== start + 1) throw new TypeError('metadata.academicYear must identify consecutive years');
  return `${start}/${end}`;
}

function semester(value) {
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

function ruleIds(series) {
  return [...new Set((series.ruleIds || []).map(String).map((value) => value.trim()).filter(Boolean))];
}

function warnings(series) {
  return [...new Set((series.warnings || []).map(String).map((value) => value.trim()).filter(Boolean))];
}

function sourceReferences(parsed, source, series) {
  const references = (series.references || []).map((reference) => ({
    role: requiredString(reference.role, 'series.references[].role'),
    range: requiredString(reference.range, 'series.references[].range'),
  }));
  references.push({
    role: 'week',
    range: `${source.companionFileName}::${parsed.period.reference}`,
  });
  for (const range of parsed.parity?.references?.slice(0, 2) || []) {
    references.push({ role: 'week', range: `${source.companionFileName}::${range}` });
  }
  return references;
}

function eventForDate({ metadata, parsed, source, series, date }) {
  const discipline = requiredString(series.discipline, 'series.discipline');
  const startTime = requiredString(series.startTime, 'series.startTime');
  const endTime = requiredString(series.endTime, 'series.endTime');
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
      start_time: startTime,
      end_time: endTime,
      all_day: false,
      time_mode: 'floating',
    },
    lesson: {
      discipline: { raw: discipline, normalized: discipline },
      type: { raw: null, code: 'unknown' },
      teachers: [],
      locations: [],
      source_note: series.parity ? `Источник: ${series.parity === 'above_line' ? 'над чертой' : 'под чертой'}` : null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: source.classFileName,
      file_hash: source.classFileHash,
      sheet: 'расписание',
      references: sourceReferences(parsed, source, series),
      raw_text: optionalString(series.rawSource),
    },
    parse: {
      status: series.status,
      rule_ids: ruleIds(series),
      warnings: warnings(series),
    },
    derived: emptyDerived(),
    calendar: { title: null, description: null, location: null },
  };
}

function normalizeInputs({ parsed, metadata, source }) {
  if (!parsed || parsed.profile !== 'IZH-WEEKLY') throw new TypeError('IZH-WEEKLY parsed result is required');
  const normalizedMetadata = {
    academicYear: academicYear(metadata?.academicYear),
    semester: semester(metadata?.semester),
    facultyCode: requiredString(metadata?.facultyCode, 'metadata.facultyCode'),
    course: Number(metadata?.course),
    group: requiredString(metadata?.groupCode ?? parsed.group, 'metadata.group'),
    stream: optionalString(metadata?.stream),
  };
  if (!Number.isInteger(normalizedMetadata.course) || normalizedMetadata.course < 1 || normalizedMetadata.course > 10) {
    throw new TypeError('metadata.course must be an integer from 1 to 10');
  }
  if (normalizedMetadata.group !== String(parsed.group)) throw new TypeError('metadata group must match parsed group');
  const normalizedSource = {
    classFileName: requiredString(source?.classFileName, 'source.classFileName'),
    classFileHash: optionalString(source?.classFileHash),
    companionFileName: requiredString(source?.companionFileName, 'source.companionFileName'),
    companionFileHash: optionalString(source?.companionFileHash),
  };
  return { metadata: normalizedMetadata, source: normalizedSource };
}

export function izhgmuWeeklyBlockers(parsed) {
  return [
    ...(parsed?.reviewRequired || []).map((item) => ({
      kind: 'series_review',
      warning: item.warning || item.warnings?.[0] || 'needs_review',
      reference: item.references?.[0]?.range || null,
      discipline: item.discipline || null,
    })),
    ...(parsed?.deferred || []).map((item) => ({
      kind: 'companion_deferred',
      warning: item.reason || 'stream_wide_companion_owned',
      reference: item.ref || null,
      discipline: item.value || null,
    })),
  ];
}

export function assertIzhgmuWeeklyComplete(parsed) {
  const blockers = izhgmuWeeklyBlockers(parsed);
  if (!parsed?.publishable || blockers.length) {
    const error = new Error(`IZH-WEEKLY source is incomplete: ${blockers.length} blocker(s)`);
    error.code = 'IZH_WEEKLY_INCOMPLETE';
    error.blockers = blockers;
    throw error;
  }
  return parsed;
}

function canonicalCandidate({ parsed, metadata, source, parserName }) {
  const normalized = normalizeInputs({ parsed, metadata, source });
  const safeSeries = (parsed.series || []).filter(
    (series) => series.status === 'ok' && series.startTime && series.endTime && Array.isArray(series.dates) && series.dates.length,
  );
  const events = [];
  for (const series of safeSeries) {
    for (const date of [...new Set(series.dates)]) {
      events.push(eventForDate({
        metadata: normalized.metadata,
        parsed,
        source: normalized.source,
        series,
        date,
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
      source_files: [normalized.source.classFileName, normalized.source.companionFileName],
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

/**
 * QA-only canonical projection of already unambiguous IZH-WEEKLY series.
 * It is deliberately named "candidate" because unresolved/deferred source
 * content is omitted and production publication must never call this helper.
 */
export function buildIzhgmuWeeklyQaCandidate(input) {
  return canonicalCandidate({ ...input, parserName: 'izhgmu-weekly-v1-qa-candidate' });
}

/** Production boundary: incomplete weekly sources fail before canonical publication. */
export function buildIzhgmuWeeklyCanonicalBatch(input) {
  assertIzhgmuWeeklyComplete(input.parsed);
  return canonicalCandidate({ ...input, parserName: 'izhgmu-weekly-v1' });
}
