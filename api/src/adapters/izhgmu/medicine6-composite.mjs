import { buildIzhgmuCycleQaCandidate, izhgmuCycleBlockers } from './cycle-canonical.mjs';
import {
  buildIzhgmuMedicine6LectureQaCandidate,
  izhgmuMedicine6LectureBlockers,
} from './lecture-medicine6-canonical.mjs';
import {
  buildIzhgmuMedicine6PostsemesterCandidate,
  buildIzhgmuMedicine6PostsemesterQaBatch,
} from './postsemester-canonical.mjs';
import { IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW } from './postsemester-reviewed.mjs';

const COMPOSITE_PERIOD = Object.freeze({
  start_date: '2026-02-02',
  end_date: '2026-06-22',
  week1_start_date: '2026-02-02',
});

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function componentBlockers(component, items) {
  return (items || []).map((item) => ({
    component,
    ...item,
  }));
}

function eventKey(event) {
  return [
    event?.timing?.date,
    event?.timing?.start_time || '',
    event?.timing?.end_time || '',
    event?.timing?.all_day ? '1' : '0',
    event?.lesson?.discipline?.normalized || event?.lesson?.discipline?.raw || '',
    event?.lesson?.type?.code || '',
    event?.audience?.group || '',
  ].join('|');
}

function assertSameScheduleContext(batches, { group, academicYear, semester, facultyCode, course }) {
  for (const batch of batches) {
    const schedule = batch?.schedule;
    if (!schedule) throw new TypeError('Composite component schedule is required');
    if (
      schedule.university_code !== 'izhgmu'
      || schedule.group !== group
      || schedule.academic_year !== academicYear
      || schedule.semester !== semester
      || schedule.faculty_code !== facultyCode
      || Number(schedule.course) !== course
    ) {
      const error = new Error(`IzhGMU medicine-6 composite context mismatch in ${schedule.parser || 'unknown component'}`);
      error.code = 'IZH_M6_COMPOSITE_CONTEXT_MISMATCH';
      error.expected = { university_code: 'izhgmu', group, academic_year: academicYear, semester, faculty_code: facultyCode, course };
      error.observed = {
        university_code: schedule.university_code,
        group: schedule.group,
        academic_year: schedule.academic_year,
        semester: schedule.semester,
        faculty_code: schedule.faculty_code,
        course: schedule.course,
      };
      throw error;
    }
  }
}

export function buildIzhgmuMedicine6CompositeCandidate({
  cycle,
  lecture,
  metadata,
  postsemesterReview = IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW,
} = {}) {
  const group = requiredString(metadata?.groupCode, 'metadata.groupCode');
  requiredString(metadata?.academicYear, 'metadata.academicYear');
  requiredString(metadata?.semester, 'metadata.semester');
  const facultyCode = requiredString(metadata?.facultyCode, 'metadata.facultyCode');
  const course = Number(metadata?.course);
  if (course !== 6) throw new TypeError('metadata.course must be 6');

  const cycleBatch = buildIzhgmuCycleQaCandidate({
    parsed: cycle?.parsed,
    metadata,
    source: cycle?.source,
  });
  const lectureBatch = buildIzhgmuMedicine6LectureQaCandidate({
    parsed: lecture?.parsed,
    metadata,
    source: lecture?.source,
  });
  const postsemesterBatch = buildIzhgmuMedicine6PostsemesterQaBatch({ group, review: postsemesterReview });
  const postsemesterCandidate = buildIzhgmuMedicine6PostsemesterCandidate({ group, review: postsemesterReview });

  const normalizedAcademicYear = cycleBatch.schedule.academic_year;
  const normalizedSemester = cycleBatch.schedule.semester;
  assertSameScheduleContext(
    [cycleBatch, lectureBatch, postsemesterBatch],
    { group, academicYear: normalizedAcademicYear, semester: normalizedSemester, facultyCode, course },
  );

  const events = [...cycleBatch.events, ...lectureBatch.events, ...postsemesterBatch.events]
    .sort((left, right) => {
      const a = `${left.timing.date}T${left.timing.start_time || '00:00'}|${left.lesson.discipline.normalized}|${left.lesson.type.code}`;
      const b = `${right.timing.date}T${right.timing.start_time || '00:00'}|${right.lesson.discipline.normalized}|${right.lesson.type.code}`;
      return a.localeCompare(b);
    });
  const keys = events.map(eventKey);
  const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicateKeys.length) {
    const error = new Error(`IzhGMU medicine-6 composite contains duplicate component events: ${duplicateKeys.length}`);
    error.code = 'IZH_M6_COMPOSITE_DUPLICATE_COMPONENT_EVENT';
    error.duplicates = duplicateKeys;
    throw error;
  }

  const cycleBlockers = izhgmuCycleBlockers(cycle?.parsed);
  const lectureBlockers = izhgmuMedicine6LectureBlockers(lecture?.parsed);
  const blockers = [
    ...componentBlockers('cycle', cycleBlockers),
    ...componentBlockers('lecture', lectureBlockers),
    ...componentBlockers('postsemester', postsemesterCandidate.blockers),
  ];

  return {
    profile: 'IZH-MEDICINE6-COMPOSITE-CANDIDATE',
    group,
    componentStats: {
      cycleEvents: cycleBatch.events.length,
      lectureEvents: lectureBatch.events.length,
      postsemesterEvents: postsemesterBatch.events.length,
      totalEvents: events.length,
      deferredPostsemesterFacts: postsemesterCandidate.deferredFacts.length,
      cycleBlockers: cycleBlockers.length,
      lectureBlockers: lectureBlockers.length,
      postsemesterBlockers: postsemesterCandidate.blockers.length,
      totalBlockers: blockers.length,
    },
    deferredFacts: postsemesterCandidate.deferredFacts,
    blockers,
    publishable: blockers.length === 0,
    batch: {
      schema_version: '1.0',
      schedule: {
        university_code: 'izhgmu',
        academic_year: normalizedAcademicYear,
        semester: normalizedSemester,
        faculty_code: facultyCode,
        course,
        group,
        period: { ...COMPOSITE_PERIOD },
        source_files: [...new Set([
          ...(cycleBatch.schedule.source_files || []),
          ...(lectureBatch.schedule.source_files || []),
          ...(postsemesterBatch.schedule.source_files || []),
        ])],
        generated_at: null,
        parser: 'izhgmu-medicine6-composite-v1-qa-candidate',
        schedule_version_id: null,
        previous_schedule_version_id: null,
        content_fingerprint: null,
        version_created_at: null,
      },
      events,
    },
  };
}

export function assertIzhgmuMedicine6CompositeComplete(input = {}) {
  const candidate = buildIzhgmuMedicine6CompositeCandidate(input);
  if (candidate.blockers.length) {
    const error = new Error(`IzhGMU medicine-6 composite is incomplete for group ${candidate.group}: ${candidate.blockers.length} blocker(s)`);
    error.code = 'IZH_M6_COMPOSITE_INCOMPLETE';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    error.deferredFacts = candidate.deferredFacts;
    throw error;
  }
  return candidate;
}

export function buildIzhgmuMedicine6CompositeCanonicalBatch(input = {}) {
  const candidate = assertIzhgmuMedicine6CompositeComplete(input);
  return {
    ...candidate.batch,
    schedule: {
      ...candidate.batch.schedule,
      parser: 'izhgmu-medicine6-composite-v1',
    },
  };
}
