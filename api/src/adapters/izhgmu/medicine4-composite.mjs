import { buildIzhgmuCycleQaCandidate, izhgmuCycleBlockers } from './cycle-canonical.mjs';

const FACULTY_NAMES = Object.freeze({
  medicine: 'Лечебный факультет',
  pediatrics: 'Педиатрический факультет',
  dentistry: 'Стоматологический факультет',
});

const REFERENCE_ROLE = Object.freeze({
  discipline: 'lesson',
  lesson: 'lesson',
  date: 'date',
  start_time: 'time',
  end_time: 'time',
  time: 'time',
  location: 'location',
  declared_count: 'note',
  note: 'note',
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

function uniqueStrings(values, name) {
  if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array`);
  const normalized = values.map((value) => requiredString(value, `${name}[]`));
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) throw new TypeError(`${name} contains duplicates`);
  return unique;
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
  return (series.references || []).map((reference) => ({
    role: REFERENCE_ROLE[requiredString(reference.role, 'series.references[].role')] || 'other',
    range: requiredString(reference.range, 'series.references[].range'),
  }));
}

function eventKey(event) {
  return [
    event?.timing?.date,
    event?.timing?.start_time || '',
    event?.timing?.end_time || '',
    event?.lesson?.discipline?.normalized || event?.lesson?.discipline?.raw || '',
    event?.lesson?.type?.code || '',
    event?.audience?.group || '',
  ].join('|');
}

function mappingError(status) {
  const error = new Error('IzhGMU medicine-4 stream-group map is not an exact course partition');
  error.code = 'IZH_M4_STREAM_GROUP_MAP_INVALID';
  error.mappingStatus = status;
  return error;
}

export function validateIzhgmuMedicine4StreamGroupMap({ courseGroups, streamGroupMap } = {}) {
  const groups = uniqueStrings(courseGroups, 'courseGroups');
  if (streamGroupMap == null) {
    return {
      provided: false,
      valid: false,
      courseGroups: groups,
      streams: { '1': [], '2': [] },
      mappedGroups: [],
      missingGroups: [...groups],
      unknownGroups: [],
      duplicateGroups: [],
      streamForGroup: {},
    };
  }
  if (typeof streamGroupMap !== 'object' || Array.isArray(streamGroupMap)) throw mappingError({ reason: 'map_not_object' });
  const keys = Object.keys(streamGroupMap).sort();
  if (keys.length !== 2 || keys[0] !== '1' || keys[1] !== '2') throw mappingError({ reason: 'streams_must_be_exactly_1_and_2', keys });

  const streams = {};
  for (const stream of ['1', '2']) {
    if (!Array.isArray(streamGroupMap[stream]) || !streamGroupMap[stream].length) {
      throw mappingError({ reason: 'stream_group_list_empty', stream });
    }
    streams[stream] = streamGroupMap[stream].map((value) => requiredString(value, `streamGroupMap.${stream}[]`));
  }

  const flattened = [...streams['1'], ...streams['2']];
  const counts = new Map();
  for (const group of flattened) counts.set(group, (counts.get(group) || 0) + 1);
  const duplicateGroups = [...counts.entries()].filter(([, count]) => count > 1).map(([group]) => group).sort();
  const courseSet = new Set(groups);
  const unknownGroups = [...new Set(flattened.filter((group) => !courseSet.has(group)))].sort();
  const mappedSet = new Set(flattened.filter((group) => courseSet.has(group)));
  const missingGroups = groups.filter((group) => !mappedSet.has(group));
  const valid = duplicateGroups.length === 0 && unknownGroups.length === 0 && missingGroups.length === 0 && mappedSet.size === groups.length;
  const streamForGroup = {};
  if (valid) {
    for (const stream of ['1', '2']) for (const group of streams[stream]) streamForGroup[group] = Number(stream);
  }
  const status = {
    provided: true,
    valid,
    courseGroups: groups,
    streams,
    mappedGroups: [...mappedSet].sort(),
    missingGroups,
    unknownGroups,
    duplicateGroups,
    streamForGroup,
  };
  if (!valid) throw mappingError(status);
  return status;
}

function reviewedEvidence(evidence) {
  return Boolean(
    evidence
    && evidence.reviewed === true
    && evidence.kind === 'official'
    && String(evidence.reference || '').trim(),
  );
}

function lectureStructuralBlockers(parsed, stream) {
  if (parsed?.profile !== 'IZH-LECTURE-MEDICINE4-STREAM' || Number(parsed?.stream) !== Number(stream)) {
    const error = new TypeError(`medicine-4 lecture stream ${stream} parsed result is required`);
    error.code = 'IZH_M4_LECTURE_COMPONENT_INVALID';
    throw error;
  }
  return [
    ...(parsed.reviewRequired || []).map((item) => ({
      source_component: `lecture_stream_${stream}`,
      kind: 'series_review',
      warning: item.warning || item.warnings?.[0] || 'needs_review',
      reference: item.references?.[0]?.range || null,
      discipline: item.discipline || null,
    })),
    ...(parsed.blockers || [])
      .filter((item) => item.warning !== 'stream_group_mapping_required')
      .map((item) => ({
        ...item,
        source_component: `lecture_stream_${stream}`,
        kind: 'series_review',
      })),
  ];
}

function lectureEvent({ series, date, metadata, source, stream }) {
  const location = canonicalLocation(series.location);
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
    university: { code: 'izhgmu', name: 'Ижевский государственный медицинский университет' },
    academic: {
      academic_year: metadata.academicYear,
      semester: metadata.semester,
      faculty_code: metadata.facultyCode,
      faculty_name: FACULTY_NAMES[metadata.facultyCode] || null,
      course: metadata.course,
    },
    audience: { group: metadata.groupCode, scope: 'whole_group', subgroups: [], stream: String(stream) },
    timing: {
      date,
      start_time: requiredString(series.startTime, 'series.startTime'),
      end_time: requiredString(series.endTime, 'series.endTime'),
      all_day: false,
      time_mode: 'floating',
    },
    lesson: {
      discipline: { raw: discipline, normalized: discipline },
      type: { raw: 'лекция', code: 'lecture' },
      teachers: [],
      locations: location ? [location] : [],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: requiredString(source.fileName, 'lecture source.fileName'),
      file_hash: optionalString(source.fileHash),
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

function assertPeriods(cycleParsed, lectureParsedByStream) {
  for (const stream of ['1', '2']) {
    const parsed = lectureParsedByStream?.[stream];
    if (!parsed) throw new TypeError(`lectureParsedByStream.${stream} is required`);
    if (
      parsed.period?.start_date !== cycleParsed.period?.start_date
      || parsed.period?.end_date !== cycleParsed.period?.end_date
    ) {
      const error = new Error(`IzhGMU medicine-4 cycle/lecture period mismatch for stream ${stream}`);
      error.code = 'IZH_M4_COMPOSITE_PERIOD_MISMATCH';
      throw error;
    }
  }
}

export function buildIzhgmuMedicine4CompositeCandidate({
  cycle,
  lectures,
  metadata,
  courseGroups,
  streamGroupMap = null,
  streamGroupEvidence = null,
} = {}) {
  const group = requiredString(metadata?.groupCode, 'metadata.groupCode');
  const course = Number(metadata?.course);
  if (course !== 4) throw new TypeError('metadata.course must be 4');
  const facultyCode = requiredString(metadata?.facultyCode, 'metadata.facultyCode');
  if (facultyCode !== 'medicine') throw new TypeError('metadata.facultyCode must be medicine for medicine-4 composite');
  const normalizedGroups = uniqueStrings(courseGroups, 'courseGroups');
  if (!normalizedGroups.includes(group)) throw new TypeError(`metadata.groupCode is not in courseGroups: ${group}`);
  if (cycle?.parsed?.profile !== 'IZH-CYCLE') throw new TypeError('cycle.parsed IZH-CYCLE result is required');
  if (String(cycle.parsed.group) !== group) throw new TypeError('cycle.parsed group must match metadata.groupCode');
  assertPeriods(cycle.parsed, { '1': lectures?.['1']?.parsed, '2': lectures?.['2']?.parsed });

  const mappingStatus = validateIzhgmuMedicine4StreamGroupMap({ courseGroups: normalizedGroups, streamGroupMap });
  const evidenceReady = mappingStatus.valid && reviewedEvidence(streamGroupEvidence);
  const selectedStream = evidenceReady ? mappingStatus.streamForGroup[group] : null;

  const cycleBatch = buildIzhgmuCycleQaCandidate({ parsed: cycle.parsed, metadata, source: cycle.source });
  const cycleBlockers = izhgmuCycleBlockers(cycle.parsed).map((item) => ({ ...item, source_component: 'cycle' }));
  const lectureBlockers = [
    ...lectureStructuralBlockers(lectures?.['1']?.parsed, 1),
    ...lectureStructuralBlockers(lectures?.['2']?.parsed, 2),
  ];
  const mappingBlockers = [];
  if (!mappingStatus.provided) {
    mappingBlockers.push({
      source_component: 'audience_mapping',
      kind: 'audience_mapping',
      warning: 'stream_group_mapping_required',
      streams: [1, 2],
      groups: normalizedGroups,
    });
  } else if (!evidenceReady) {
    mappingBlockers.push({
      source_component: 'audience_mapping',
      kind: 'audience_mapping',
      warning: 'stream_group_mapping_evidence_required',
      streams: [1, 2],
      groups: normalizedGroups,
    });
  }

  const lectureEvents = [];
  if (selectedStream) {
    const component = lectures[String(selectedStream)];
    for (const series of component.parsed.safeSeries || []) {
      if (series.status !== 'ok' || !series.startTime || !series.endTime) continue;
      for (const date of [...new Set(series.dates || [])]) {
        lectureEvents.push(lectureEvent({
          series,
          date,
          metadata: {
            academicYear: cycleBatch.schedule.academic_year,
            semester: cycleBatch.schedule.semester,
            facultyCode,
            course,
            groupCode: group,
          },
          source: component.source,
          stream: selectedStream,
        }));
      }
    }
  }

  const events = [...cycleBatch.events, ...lectureEvents].sort((left, right) => {
    const a = `${left.timing.date}T${left.timing.start_time}|${left.lesson.discipline.normalized}|${left.lesson.type.code}`;
    const b = `${right.timing.date}T${right.timing.start_time}|${right.lesson.discipline.normalized}|${right.lesson.type.code}`;
    return a.localeCompare(b);
  });
  const keys = events.map(eventKey);
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicates.length) {
    const error = new Error(`IzhGMU medicine-4 composite contains duplicate component events: ${duplicates.length}`);
    error.code = 'IZH_M4_COMPOSITE_DUPLICATE_COMPONENT_EVENT';
    error.duplicates = duplicates;
    throw error;
  }

  const blockers = [...cycleBlockers, ...lectureBlockers, ...mappingBlockers];
  return {
    profile: 'IZH-MEDICINE4-COMPOSITE-CANDIDATE',
    group,
    selectedStream,
    mappingStatus,
    streamGroupEvidence: streamGroupEvidence || null,
    blockers,
    publishable: blockers.length === 0,
    componentStats: {
      cycleEvents: cycleBatch.events.length,
      lectureEvents: lectureEvents.length,
      totalEvents: events.length,
      cycleBlockers: cycleBlockers.length,
      lectureBlockers: lectureBlockers.length,
      mappingBlockers: mappingBlockers.length,
      totalBlockers: blockers.length,
    },
    batch: {
      schema_version: '1.0',
      schedule: {
        ...cycleBatch.schedule,
        source_files: [...new Set([
          ...(cycleBatch.schedule.source_files || []),
          ...(selectedStream ? [requiredString(lectures[String(selectedStream)]?.source?.fileName, 'selected lecture source.fileName')] : []),
        ])],
        parser: 'izhgmu-medicine4-composite-v1-qa-candidate',
      },
      events,
    },
  };
}

export function assertIzhgmuMedicine4CompositeComplete(input = {}) {
  let candidate;
  try {
    candidate = buildIzhgmuMedicine4CompositeCandidate(input);
  } catch (error) {
    if (error?.code === 'IZH_M4_STREAM_GROUP_MAP_INVALID') throw error;
    throw error;
  }
  const warningSet = new Set(candidate.blockers.map((item) => item.warning));
  if (warningSet.has('stream_group_mapping_required')) {
    const error = new Error(`IzhGMU medicine-4 stream-group mapping is required for group ${candidate.group}`);
    error.code = 'IZH_M4_STREAM_GROUP_MAPPING_REQUIRED';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    throw error;
  }
  if (warningSet.has('stream_group_mapping_evidence_required')) {
    const error = new Error(`IzhGMU medicine-4 reviewed official stream-group evidence is required for group ${candidate.group}`);
    error.code = 'IZH_M4_STREAM_GROUP_MAPPING_EVIDENCE_REQUIRED';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    throw error;
  }
  if (candidate.blockers.length) {
    const error = new Error(`IzhGMU medicine-4 composite is incomplete for group ${candidate.group}: ${candidate.blockers.length} blocker(s)`);
    error.code = 'IZH_M4_COMPOSITE_INCOMPLETE';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    throw error;
  }
  return candidate;
}

export function buildIzhgmuMedicine4CompositeCanonicalBatch(input = {}) {
  const candidate = assertIzhgmuMedicine4CompositeComplete(input);
  return {
    ...candidate.batch,
    schedule: {
      ...candidate.batch.schedule,
      parser: 'izhgmu-medicine4-composite-v1',
    },
  };
}
