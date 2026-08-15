import {
  IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW,
  medicine6CourseGroups,
} from './postsemester-reviewed.mjs';

const UNIVERSITY = Object.freeze({
  code: 'izhgmu',
  name: 'Ижевский государственный медицинский университет',
});
const FACULTY_NAME = 'Лечебный факультет';
const PERIOD = Object.freeze({
  start_date: '2026-02-02',
  end_date: '2026-06-22',
  week1_start_date: '2026-02-02',
});
const ATTESTATION_FILE = 'medicine6-intermediate-attestation-2026.pdf';
const GIA_FILE = 'medicine6-gia-2026.pdf';

function requiredGroup(value) {
  const group = String(value ?? '').trim();
  if (!medicine6CourseGroups().includes(group)) {
    throw new TypeError(`group must be one of reviewed medicine-6 groups 601-630: ${group || '<empty>'}`);
  }
  return group;
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

function baseEvent({ group, date, startTime, endTime, allDay, disciplineRaw, disciplineNormalized, typeRaw, typeCode, locations = [], sourceNote = null, fileName, fileHash, references, rawText, parseStatus = 'ok', ruleIds, warnings = [] }) {
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
    university: UNIVERSITY,
    academic: {
      academic_year: '2025/2026',
      semester: 'spring',
      faculty_code: 'medicine',
      faculty_name: FACULTY_NAME,
      course: 6,
    },
    audience: { group, scope: 'whole_group', subgroups: [], stream: null },
    timing: {
      date,
      start_time: startTime,
      end_time: endTime,
      all_day: allDay,
      time_mode: 'floating',
    },
    lesson: {
      discipline: { raw: disciplineRaw, normalized: disciplineNormalized },
      type: { raw: typeRaw, code: typeCode },
      teachers: [],
      locations: locations.map((raw) => ({ raw, building: null, room: null, address: null })),
      source_note: sourceNote,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: fileName,
      file_hash: fileHash,
      sheet: null,
      references,
      raw_text: rawText,
    },
    parse: {
      status: parseStatus,
      rule_ids: [...new Set(ruleIds)],
      warnings: [...new Set(warnings)],
    },
    derived: emptyDerived(),
    calendar: { title: null, description: null, location: null },
  };
}

function groupDate(dateMap, group) {
  const matches = Object.entries(dateMap)
    .filter(([, groups]) => groups.includes(group))
    .map(([date]) => date);
  if (matches.length > 1) {
    const error = new Error(`Reviewed post-semester source assigns multiple primary dates to group ${group}`);
    error.code = 'IZH_POSTSEMESTER_MULTIPLE_PRIMARY_DATES';
    error.group = group;
    error.dates = matches;
    throw error;
  }
  return matches[0] || null;
}

function dateOnlyAssessmentEvent({ group, assessment, date, review }) {
  const normalized = `Промежуточная аттестация: ${assessment.discipline}`;
  return baseEvent({
    group,
    date,
    startTime: null,
    endTime: null,
    allDay: true,
    disciplineRaw: assessment.discipline,
    disciplineNormalized: normalized,
    typeRaw: 'промежуточная аттестация',
    typeCode: 'other',
    sourceNote: 'Точная дата группы указана в официальном PDF. Время проведения в источнике не указано.',
    fileName: ATTESTATION_FILE,
    fileHash: review.sourceHashes.intermediateAttestation,
    references: [
      { role: 'lesson', range: `page 1 / ${assessment.discipline}` },
      { role: 'date', range: `page 1 / ${assessment.discipline} / ${date} / группа ${group}` },
    ],
    rawText: `${assessment.discipline}: группа ${group} — ${date}`,
    parseStatus: 'warning',
    ruleIds: ['IZH-P03', 'IZH-P09'],
    warnings: ['time_not_specified_in_source'],
  });
}

function consultationEvent({ group, review }) {
  const consultation = review.gia.consultation;
  const agenda = consultation.segments
    .map((item) => `${item.startTime}–${item.endTime} ${item.discipline}`)
    .join('; ');
  return baseEvent({
    group,
    date: consultation.date,
    startTime: consultation.startTime,
    endTime: consultation.endTime,
    allDay: false,
    disciplineRaw: 'Предэкзаменационная консультация',
    disciplineNormalized: 'Предэкзаменационная консультация ГИА',
    typeRaw: 'консультация',
    typeCode: 'consultation',
    locations: [consultation.location],
    sourceNote: `Программа консультации: ${agenda}.`,
    fileName: GIA_FILE,
    fileHash: review.sourceHashes.gia,
    references: [
      { role: 'date', range: `page 1 / консультация / ${consultation.date}` },
      { role: 'time', range: `page 1 / консультация / ${consultation.startTime}-${consultation.endTime}` },
      { role: 'location', range: 'page 1 / консультация / место проведения' },
      { role: 'note', range: 'page 1 / консультация / 4 тематических блока' },
    ],
    rawText: `Предэкзаменационная консультация ${consultation.date} ${consultation.startTime}-${consultation.endTime}; ${consultation.location}; ${agenda}`,
    ruleIds: ['IZH-P03', 'IZH-P07', 'IZH-P10'],
  });
}

function stateExamDeferredFact({ group, review }) {
  const stateExam = review.gia.stateExam;
  const date = groupDate(stateExam.dates, group);
  if (!date) {
    return {
      kind: 'gia_state_exam',
      group,
      status: 'needs_review',
      warning: 'group_missing_from_reviewed_source',
      date: null,
      startTime: stateExam.startTime,
      endTime: null,
      location: stateExam.location,
      sourceFile: GIA_FILE,
      sourceHash: review.sourceHashes.gia,
      ruleIds: ['IZH-P03', 'IZH-P06', 'IZH-P11'],
    };
  }
  return {
    kind: 'gia_state_exam',
    group,
    status: 'deferred',
    warning: 'end_time_missing_in_source',
    date,
    startTime: stateExam.startTime,
    endTime: null,
    location: stateExam.location,
    sourceFile: GIA_FILE,
    sourceHash: review.sourceHashes.gia,
    references: [
      `page 1 / государственный экзамен / ${date} / группа ${group}`,
      `page 1 / государственный экзамен / начало ${stateExam.startTime}`,
      'page 1 / государственный экзамен / место проведения',
    ],
    rawText: `Государственный экзамен: группа ${group} — ${date}, начало ${stateExam.startTime}; ${stateExam.location}`,
    ruleIds: ['IZH-P03', 'IZH-P06', 'IZH-P11'],
  };
}

export function buildIzhgmuMedicine6PostsemesterCandidate({
  group: groupInput,
  review = IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW,
} = {}) {
  if (review?.profile !== 'IZH-POSTSEMESTER-MEDICINE6-REVIEWED') {
    throw new TypeError('review must be IZH-POSTSEMESTER-MEDICINE6-REVIEWED');
  }
  const group = requiredGroup(groupInput);
  const events = [];
  const blockers = [];

  for (const assessment of review.intermediateAttestation.assessments) {
    const date = groupDate(assessment.dates, group);
    if (!date) {
      blockers.push({
        kind: 'intermediate_attestation',
        component: assessment.discipline,
        warning: 'group_missing_from_reviewed_source',
        group,
        sourceFile: ATTESTATION_FILE,
        sourceHash: review.sourceHashes.intermediateAttestation,
        ruleIds: ['IZH-P03', 'IZH-P04', 'IZH-P09'],
      });
      continue;
    }
    events.push(dateOnlyAssessmentEvent({ group, assessment, date, review }));
  }

  events.push(consultationEvent({ group, review }));

  const stateExam = stateExamDeferredFact({ group, review });
  blockers.push({
    kind: 'gia_state_exam',
    component: 'Государственный экзамен',
    warning: stateExam.warning,
    group,
    date: stateExam.date,
    startTime: stateExam.startTime,
    endTime: null,
    location: stateExam.location,
    sourceFile: stateExam.sourceFile,
    sourceHash: stateExam.sourceHash,
    ruleIds: stateExam.ruleIds,
  });

  events.sort((a, b) => {
    const ak = `${a.timing.date}T${a.timing.start_time || '00:00'}|${a.lesson.discipline.normalized}`;
    const bk = `${b.timing.date}T${b.timing.start_time || '00:00'}|${b.lesson.discipline.normalized}`;
    return ak.localeCompare(bk);
  });

  return {
    profile: 'IZH-POSTSEMESTER-MEDICINE6-CANONICAL-CANDIDATE',
    group,
    events,
    deferredFacts: [stateExam],
    blockers,
    publishable: blockers.length === 0,
    sourceFiles: [ATTESTATION_FILE, GIA_FILE],
    sourceHashes: { ...review.sourceHashes },
  };
}

export function buildIzhgmuMedicine6PostsemesterQaBatch(input = {}) {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate(input);
  return {
    schema_version: '1.0',
    schedule: {
      university_code: 'izhgmu',
      academic_year: '2025/2026',
      semester: 'spring',
      faculty_code: 'medicine',
      course: 6,
      group: candidate.group,
      period: { ...PERIOD },
      source_files: candidate.sourceFiles,
      generated_at: null,
      parser: 'izhgmu-postsemester-medicine6-v1-qa-candidate',
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events: candidate.events,
  };
}

export function assertIzhgmuMedicine6PostsemesterComplete(input = {}) {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate(input);
  if (candidate.blockers.length) {
    const error = new Error(`IzhGMU medicine-6 post-semester source is incomplete for group ${candidate.group}: ${candidate.blockers.length} blocker(s)`);
    error.code = 'IZH_POSTSEMESTER_INCOMPLETE';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    error.deferredFacts = candidate.deferredFacts;
    throw error;
  }
  return candidate;
}

export function buildIzhgmuMedicine6PostsemesterCanonicalBatch(input = {}) {
  const candidate = assertIzhgmuMedicine6PostsemesterComplete(input);
  return {
    ...buildIzhgmuMedicine6PostsemesterQaBatch(input),
    schedule: {
      ...buildIzhgmuMedicine6PostsemesterQaBatch(input).schedule,
      parser: 'izhgmu-postsemester-medicine6-v1',
    },
    events: candidate.events,
  };
}
