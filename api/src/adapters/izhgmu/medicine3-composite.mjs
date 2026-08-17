import { resolveIzhgmuMedicineStream } from './medicine-stream-mapping.mjs';

const FACULTY_NAME = 'Лечебный факультет';

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
  if (value === 'spring' || Number(value) === 2) return 'spring';
  if (value === 'autumn' || Number(value) === 1) return 'autumn';
  throw new TypeError('metadata.semester must be spring/autumn or 1/2');
}

function sourceIdentity(value, name) {
  return {
    fileName: requiredString(value?.filename ?? value?.fileName, `${name}.filename`),
    fileHash: optionalString(value?.sha256 ?? value?.fileHash),
    sheet: optionalString(value?.sheet),
  };
}

function location(value) {
  const raw = optionalString(value);
  return raw ? { raw, building: null, room: null, address: null } : null;
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

function reference(role, range) {
  const normalized = optionalString(range);
  return normalized ? { role, range: normalized } : null;
}

function baseEvent({ group, stream, academicYear, semester, source, item, typeRaw, typeCode, references, rawText, cycleId = null }) {
  const place = location(item.location);
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
      academic_year: academicYear,
      semester,
      faculty_code: 'medicine',
      faculty_name: FACULTY_NAME,
      course: 3,
    },
    audience: {
      group,
      scope: 'whole_group',
      subgroups: [],
      stream,
    },
    timing: {
      date: requiredString(item.date, 'item.date'),
      start_time: requiredString(item.startTime, 'item.startTime'),
      end_time: requiredString(item.endTime, 'item.endTime'),
      all_day: false,
      time_mode: 'floating',
    },
    lesson: {
      discipline: {
        raw: requiredString(item.discipline, 'item.discipline'),
        normalized: requiredString(item.discipline, 'item.discipline'),
      },
      type: { raw: typeRaw, code: typeCode },
      teachers: [],
      locations: place ? [place] : [],
      source_note: optionalString(item.assessment) ? `Форма контроля: ${optionalString(item.assessment)}` : null,
      cycle_id: cycleId,
      joint_groups: [...new Set((item.jointGroups || []).map(String).filter(Boolean))],
    },
    source: {
      file_name: source.fileName,
      file_hash: source.fileHash,
      sheet: source.sheet,
      references: references.filter(Boolean),
      raw_text: rawText,
    },
    parse: {
      status: 'ok',
      rule_ids: [...new Set((item.ruleIds || []).map(String).filter(Boolean))],
      warnings: [],
    },
    derived: emptyDerived(),
    calendar: { title: null, description: null, location: null },
  };
}

function practiceEvent({ item, group, stream, academicYear, semester, classSource, lectureSource }) {
  const ranges = [...new Set((item.sourceRanges || []).map(String).filter(Boolean))];
  const refs = [
    ...ranges.map((range) => reference('lesson', range)),
    reference('time', item.timeReference),
  ];
  const crossSource = item.lectureReference
    ? `${lectureSource.fileName}#${lectureSource.sheet || 'sheet'}!${String(item.lectureReference).split('!').at(-1)}`
    : null;
  const rawParts = [
    `${item.discipline}; ${item.startTime}-${item.endTime}`,
    item.timeMode ? `time_mode=${item.timeMode}` : null,
    crossSource ? `cross_source_time_evidence=${crossSource}` : null,
  ].filter(Boolean);
  return baseEvent({
    group,
    stream,
    academicYear,
    semester,
    source: classSource,
    item,
    typeRaw: 'практические занятия',
    typeCode: 'practice',
    references: refs,
    rawText: rawParts.join('; '),
    cycleId: `izhgmu-m3:${group}:${item.sourceGroupSpan}:${item.discipline}`,
  });
}

function lectureEvent({ item, group, stream, academicYear, semester, lectureSource }) {
  const physical = item.sourceRole === 'physical_education';
  return baseEvent({
    group,
    stream,
    academicYear,
    semester,
    source: lectureSource,
    item,
    typeRaw: physical ? 'физическая культура и спорт' : 'лекция',
    typeCode: physical ? 'physical_education' : 'lecture',
    references: [reference('date', item.sourceReference), reference('lesson', item.sourceReference)],
    rawText: `${item.discipline}; ${item.startTime}-${item.endTime}`,
  });
}

function eventKey(event) {
  return [
    event.timing.date,
    event.timing.start_time,
    event.timing.end_time,
    event.lesson.discipline.normalized,
    event.lesson.type.code,
    event.audience.group,
    event.source.file_name,
  ].join('|');
}

export function buildIzhgmuMedicine3CompositeCandidate({ resolution, metadata } = {}) {
  if (resolution?.profile !== 'IZH-MEDICINE3-TIME-RESOLUTION' || Number(resolution?.version) !== 1) {
    throw new TypeError('IZH-MEDICINE3-TIME-RESOLUTION/v1 is required');
  }
  const group = requiredString(metadata?.groupCode, 'metadata.groupCode');
  const course = Number(metadata?.course);
  if (course !== 3) throw new TypeError('metadata.course must be 3');
  if (requiredString(metadata?.facultyCode, 'metadata.facultyCode') !== 'medicine') {
    throw new TypeError('metadata.facultyCode must be medicine');
  }
  const academicYear = normalizeAcademicYear(metadata?.academicYear);
  const semester = normalizeSemester(metadata?.semester);
  const period = metadata?.period;
  const startDate = requiredString(period?.start_date, 'metadata.period.start_date');
  const endDate = requiredString(period?.end_date, 'metadata.period.end_date');
  const week1 = requiredString(period?.week1_start_date ?? period?.start_date, 'metadata.period.week1_start_date');

  const groupResolution = resolution?.groups?.[group];
  if (!groupResolution || String(groupResolution.group) !== group) {
    const error = new Error(`IzhGMU medicine-3 group ${group} is absent from time resolution`);
    error.code = 'IZH_M3_GROUP_RESOLUTION_MISSING';
    throw error;
  }

  const streamEvidence = resolveIzhgmuMedicineStream({ course: 3, group });
  if (!streamEvidence) {
    const error = new Error(`IzhGMU medicine-3 stream mapping missing for group ${group}`);
    error.code = 'IZH_M3_STREAM_MAPPING_MISSING';
    throw error;
  }
  const requestedStream = optionalString(metadata?.stream);
  if (requestedStream && requestedStream !== streamEvidence.stream) {
    const error = new Error(`IzhGMU medicine-3 stream mismatch for group ${group}`);
    error.code = 'IZH_M3_STREAM_MAPPING_MISMATCH';
    throw error;
  }

  const classSource = sourceIdentity(resolution?.inputs?.cycleSource, 'resolution.inputs.cycleSource');
  const lectureSource = sourceIdentity(resolution?.inputs?.lectureSource, 'resolution.inputs.lectureSource');
  const events = [
    ...(groupResolution.practiceEvents || []).map((item) => practiceEvent({
      item, group, stream: streamEvidence.stream, academicYear, semester, classSource, lectureSource,
    })),
    ...(groupResolution.lectureEvents || []).map((item) => lectureEvent({
      item, group, stream: streamEvidence.stream, academicYear, semester, lectureSource,
    })),
  ].sort((left, right) => (
    `${left.timing.date}T${left.timing.start_time}|${left.lesson.type.code}|${left.lesson.discipline.normalized}`
      .localeCompare(`${right.timing.date}T${right.timing.start_time}|${right.lesson.type.code}|${right.lesson.discipline.normalized}`)
  ));

  const keys = events.map(eventKey);
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicates.length) {
    const error = new Error(`IzhGMU medicine-3 composite duplicate component events: ${duplicates.length}`);
    error.code = 'IZH_M3_COMPOSITE_DUPLICATE_COMPONENT_EVENT';
    error.duplicates = duplicates;
    throw error;
  }

  const blockers = structuredClone(groupResolution.blockers || []);
  return {
    profile: 'IZH-MEDICINE3-COMPOSITE-CANDIDATE',
    group,
    stream: streamEvidence,
    blockers,
    publishable: blockers.length === 0,
    componentStats: {
      practiceEvents: groupResolution.practiceEvents?.length || 0,
      lectureEvents: (groupResolution.lectureEvents || []).filter((item) => item.sourceRole === 'lecture').length,
      physicalEducationEvents: (groupResolution.lectureEvents || []).filter((item) => item.sourceRole === 'physical_education').length,
      totalEvents: events.length,
      blockers: blockers.length,
    },
    batch: {
      schema_version: '1.0',
      schedule: {
        university_code: 'izhgmu',
        academic_year: academicYear,
        semester,
        faculty_code: 'medicine',
        course: 3,
        group,
        period: { start_date: startDate, end_date: endDate, week1_start_date: week1 },
        source_files: [...new Set([classSource.fileName, lectureSource.fileName])],
        generated_at: null,
        parser: 'izhgmu-medicine3-composite-v1-qa-candidate',
        schedule_version_id: null,
        previous_schedule_version_id: null,
        content_fingerprint: null,
        version_created_at: null,
      },
      events,
    },
  };
}

export function assertIzhgmuMedicine3CompositeComplete(input = {}) {
  const candidate = buildIzhgmuMedicine3CompositeCandidate(input);
  if (candidate.blockers.length) {
    const error = new Error(`IzhGMU medicine-3 composite is incomplete for group ${candidate.group}: ${candidate.blockers.length} blocker(s)`);
    error.code = 'IZH_M3_COMPOSITE_INCOMPLETE';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    throw error;
  }
  return candidate;
}

export function buildIzhgmuMedicine3CompositeCanonicalBatch(input = {}) {
  const candidate = assertIzhgmuMedicine3CompositeComplete(input);
  return {
    ...candidate.batch,
    schedule: {
      ...candidate.batch.schedule,
      parser: 'izhgmu-medicine3-composite-v1',
    },
  };
}
