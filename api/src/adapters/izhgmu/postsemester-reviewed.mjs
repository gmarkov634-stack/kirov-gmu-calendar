import crypto from 'node:crypto';

export const IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW = Object.freeze({
  profile: 'IZH-POSTSEMESTER-MEDICINE6-REVIEWED',
  academicYear: '2025-2026',
  faculty: 'medicine',
  course: 6,
  sourceHashes: Object.freeze({
    intermediateAttestation: '1b25c60001dfeb40378134c483203ff2c9e1cf6bbdaef033a99c3195b701b8d5',
    gia: 'a21b5264687a64979183c6bc248f7b7336b8a78bb189847dc19eb16474df61f3',
  }),
  intermediateAttestation: Object.freeze({
    sourceId: 'medicine6-intermediate-attestation-2026',
    semesterPeriod: Object.freeze({ startDate: '2026-02-02', endDate: '2026-05-30' }),
    summerAttestationPeriod: Object.freeze({ startDate: '2026-06-01', endDate: '2026-06-08' }),
    assessments: Object.freeze([
      Object.freeze({
        discipline: 'Госпитальная терапия',
        timeBasis: 'date_only',
        dates: Object.freeze({
          '2026-06-02': Object.freeze(['601','602','603','604','605','606','607','608']),
          '2026-06-03': Object.freeze(['609','610','611','612','613','614','625']),
          '2026-06-06': Object.freeze(['615','616','617','618','619','620','621']),
          '2026-06-08': Object.freeze(['622','623','624','627','628','629','630']),
        }),
        resits: Object.freeze(['2026-06-11','2026-06-13']),
      }),
      Object.freeze({
        discipline: 'Поликлиническая терапия',
        timeBasis: 'date_only',
        dates: Object.freeze({
          '2026-06-02': Object.freeze(['615','616','617','618','619','620','621']),
          '2026-06-03': Object.freeze(['622','623','624','627','628','629','630']),
          '2026-06-06': Object.freeze(['601','602','603','604','605','606','607','608']),
          '2026-06-08': Object.freeze(['609','610','611','612','613','614','625']),
        }),
        resits: Object.freeze(['2026-06-11','2026-06-13']),
      }),
      Object.freeze({
        discipline: 'Фтизиатрия',
        timeBasis: 'date_only',
        dates: Object.freeze({
          '2026-03-02': Object.freeze(['601','602']),
          '2026-04-02': Object.freeze(['603','604','623','624']),
          '2026-05-02': Object.freeze(['605','606']),
          '2026-05-16': Object.freeze(['607','608','619','620']),
          '2026-03-26': Object.freeze(['609','610']),
          '2026-04-04': Object.freeze(['611','612']),
          '2026-02-28': Object.freeze(['613','614']),
          '2026-03-14': Object.freeze(['615','616']),
          '2026-04-21': Object.freeze(['617','618']),
          '2026-04-25': Object.freeze(['621','622']),
          '2026-03-07': Object.freeze(['625','626']),
          '2026-04-14': Object.freeze(['627','628']),
          '2026-03-20': Object.freeze(['629','630']),
        }),
        resits: Object.freeze(['2026-05-21','2026-05-28']),
      }),
    ]),
  }),
  gia: Object.freeze({
    sourceId: 'medicine6-gia-2026',
    order: Object.freeze({ date: '2026-05-14', number: '206/07-02' }),
    stateExam: Object.freeze({
      startTime: '08:00',
      timeBasis: 'start_only',
      location: 'аудитория № 3 морфологического корпуса',
      dates: Object.freeze({
        '2026-06-15': Object.freeze(['605','606','608','619','623','624','626']),
        '2026-06-16': Object.freeze(['602','603','604','607','613','616']),
        '2026-06-17': Object.freeze(['601','609','612','615','625']),
        '2026-06-18': Object.freeze(['611','614','617','620','621','622']),
        '2026-06-19': Object.freeze(['610','618','627','628','629','630']),
      }),
    }),
    consultation: Object.freeze({
      scope: 'course_wide',
      date: '2026-06-10',
      startTime: '13:00',
      endTime: '14:00',
      location: 'актовый зал теоретического корпуса',
      segments: Object.freeze([
        Object.freeze({ discipline: 'Поликлиническая терапия', startTime: '13:00', endTime: '13:15' }),
        Object.freeze({ discipline: 'Госпитальная терапия', startTime: '13:15', endTime: '13:30' }),
        Object.freeze({ discipline: 'Инфекционные болезни', startTime: '13:30', endTime: '13:45' }),
        Object.freeze({ discipline: 'Госпитальная хирургия', startTime: '13:45', endTime: '14:00' }),
      ]),
    }),
  }),
});

export function medicine6CourseGroups() {
  return Array.from({ length: 30 }, (_, index) => String(601 + index));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function flattenDateGroups(dateMap) {
  return Object.entries(dateMap).flatMap(([date, groups]) => groups.map((group) => ({ group, date })));
}

function coverage(dateMap) {
  const courseGroups = medicine6CourseGroups();
  const entries = flattenDateGroups(dateMap);
  const counts = new Map(courseGroups.map((group) => [group, 0]));
  const unexpected = [];
  for (const { group } of entries) {
    if (!counts.has(group)) unexpected.push(group);
    else counts.set(group, counts.get(group) + 1);
  }
  return {
    entries: entries.length,
    coveredGroups: courseGroups.filter((group) => counts.get(group) > 0),
    missingGroups: courseGroups.filter((group) => counts.get(group) === 0),
    duplicateGroups: courseGroups.filter((group) => counts.get(group) > 1),
    unexpectedGroups: [...new Set(unexpected)],
  };
}

export function analyzeIzhgmuMedicine6PostsemesterReview(review = IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW) {
  const hospital = review.intermediateAttestation.assessments.find((item) => item.discipline === 'Госпитальная терапия');
  const polyclinic = review.intermediateAttestation.assessments.find((item) => item.discipline === 'Поликлиническая терапия');
  const phthisiology = review.intermediateAttestation.assessments.find((item) => item.discipline === 'Фтизиатрия');
  const hospitalCoverage = coverage(hospital.dates);
  const polyclinicCoverage = coverage(polyclinic.dates);
  const phthisiologyCoverage = coverage(phthisiology.dates);
  const giaCoverage = coverage(review.gia.stateExam.dates);
  const blockers = [];
  for (const [component, result] of [
    ['hospital_therapy', hospitalCoverage],
    ['polyclinic_therapy', polyclinicCoverage],
    ['phthisiology', phthisiologyCoverage],
    ['gia', giaCoverage],
  ]) {
    if (result.missingGroups.length) blockers.push({ component, warning: 'group_missing_from_reviewed_source', groups: result.missingGroups });
    if (result.duplicateGroups.length) blockers.push({ component, warning: 'group_has_multiple_primary_dates', groups: result.duplicateGroups });
    if (result.unexpectedGroups.length) blockers.push({ component, warning: 'unexpected_group_in_reviewed_source', groups: result.unexpectedGroups });
  }
  return {
    profile: review.profile,
    coverage: {
      hospitalTherapy: hospitalCoverage,
      polyclinicTherapy: polyclinicCoverage,
      phthisiology: phthisiologyCoverage,
      gia: giaCoverage,
    },
    consultationSegments: review.gia.consultation.segments.length,
    blockers,
    intermediateAttestationPublishable: !blockers.some((item) => item.component !== 'gia'),
    giaPublishable: !blockers.some((item) => item.component === 'gia'),
    publishable: blockers.length === 0,
  };
}

export function verifyIzhgmuMedicine6PostsemesterReview({ intermediateAttestationBuffer, giaBuffer }) {
  if (!Buffer.isBuffer(intermediateAttestationBuffer) || !Buffer.isBuffer(giaBuffer)) {
    throw new TypeError('Both reviewed IzhGMU post-semester PDF buffers are required');
  }
  const observed = {
    intermediateAttestation: sha256(intermediateAttestationBuffer),
    gia: sha256(giaBuffer),
  };
  const expected = IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW.sourceHashes;
  if (observed.intermediateAttestation !== expected.intermediateAttestation || observed.gia !== expected.gia) {
    const error = new Error('Reviewed IzhGMU post-semester PDF SHA changed');
    error.code = 'IZH_POSTSEMESTER_REVIEW_SHA_MISMATCH';
    error.expected = expected;
    error.observed = observed;
    throw error;
  }
  return {
    review: IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW,
    analysis: analyzeIzhgmuMedicine6PostsemesterReview(),
    observedHashes: observed,
  };
}
