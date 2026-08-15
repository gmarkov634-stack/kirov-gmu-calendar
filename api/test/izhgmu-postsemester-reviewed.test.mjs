import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW,
  medicine6CourseGroups,
  analyzeIzhgmuMedicine6PostsemesterReview,
  verifyIzhgmuMedicine6PostsemesterReview,
} from '../src/adapters/izhgmu/postsemester-reviewed.mjs';

test('reviewed medicine-6 post-semester extraction is bound to exact PDF hashes', () => {
  assert.match(IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW.sourceHashes.intermediateAttestation, /^[0-9a-f]{64}$/);
  assert.match(IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW.sourceHashes.gia, /^[0-9a-f]{64}$/);
  assert.throws(
    () => verifyIzhgmuMedicine6PostsemesterReview({
      intermediateAttestationBuffer: Buffer.from('%PDF-wrong-attestation'),
      giaBuffer: Buffer.from('%PDF-wrong-gia'),
    }),
    (error) => error.code === 'IZH_POSTSEMESTER_REVIEW_SHA_MISMATCH',
  );
});

test('reviewed medicine-6 post-semester extraction covers exactly groups 601-630', () => {
  assert.deepEqual(medicine6CourseGroups(), Array.from({ length: 30 }, (_, index) => String(601 + index)));
  const result = analyzeIzhgmuMedicine6PostsemesterReview();
  assert.equal(result.coverage.phthisiology.coveredGroups.length, 30);
  assert.deepEqual(result.coverage.phthisiology.missingGroups, []);
  assert.deepEqual(result.coverage.phthisiology.duplicateGroups, []);
  assert.equal(result.coverage.gia.coveredGroups.length, 30);
  assert.deepEqual(result.coverage.gia.missingGroups, []);
  assert.deepEqual(result.coverage.gia.duplicateGroups, []);
  assert.equal(result.giaPublishable, true);
});

test('reviewed summer therapy table fails closed on source omission of group 626', () => {
  const result = analyzeIzhgmuMedicine6PostsemesterReview();
  assert.equal(result.coverage.hospitalTherapy.entries, 29);
  assert.equal(result.coverage.polyclinicTherapy.entries, 29);
  assert.deepEqual(result.coverage.hospitalTherapy.missingGroups, ['626']);
  assert.deepEqual(result.coverage.polyclinicTherapy.missingGroups, ['626']);
  assert.equal(result.intermediateAttestationPublishable, false);
  assert.equal(result.publishable, false);
  assert.deepEqual(
    result.blockers.map((item) => [item.component, item.warning, item.groups]),
    [
      ['hospital_therapy', 'group_missing_from_reviewed_source', ['626']],
      ['polyclinic_therapy', 'group_missing_from_reviewed_source', ['626']],
    ],
  );
});

test('GIA review preserves exact exam dates and four consultation segments', () => {
  const review = IZHGMU_MEDICINE6_POSTSEMESTER_REVIEW;
  assert.deepEqual(review.gia.stateExam.dates['2026-06-15'], ['605','606','608','619','623','624','626']);
  assert.deepEqual(review.gia.stateExam.dates['2026-06-19'], ['610','618','627','628','629','630']);
  assert.equal(review.gia.stateExam.startTime, '08:00');
  assert.equal(review.gia.stateExam.location, 'аудитория № 3 морфологического корпуса');
  assert.equal(review.gia.consultation.date, '2026-06-10');
  assert.equal(review.gia.consultation.startTime, '13:00');
  assert.equal(review.gia.consultation.endTime, '14:00');
  assert.equal(review.gia.consultation.segments.length, 4);
});
