const STREAM_RANGES = Object.freeze({
  1: Object.freeze([
    Object.freeze({ stream: '1', first: 101, last: 110, evidence: 'current_course1_class_stream_files' }),
    Object.freeze({ stream: '2', first: 111, last: 120, evidence: 'current_course1_class_stream_files' }),
    Object.freeze({ stream: '3', first: 121, last: 130, evidence: 'current_course1_class_stream_files' }),
  ]),
  2: Object.freeze([
    Object.freeze({ stream: '1', first: 201, last: 210, evidence: 'current_course2_class_stream_files' }),
    Object.freeze({ stream: '2', first: 211, last: 220, evidence: 'current_course2_class_stream_files' }),
    Object.freeze({ stream: '3', first: 221, last: 230, evidence: 'current_course2_class_stream_files' }),
  ]),
  3: Object.freeze([
    Object.freeze({ stream: '1', first: 301, last: 310, evidence: 'current_course3_lecture_explicit_range' }),
    Object.freeze({ stream: '2', first: 311, last: 318, evidence: 'current_course3_lecture_explicit_range' }),
    Object.freeze({ stream: '3', first: 319, last: 326, evidence: 'current_course3_lecture_explicit_range' }),
  ]),
});

export function resolveIzhgmuMedicineStream({ course, group }) {
  const normalizedCourse = Number(course);
  const normalizedGroup = Number(String(group));
  if (!Number.isInteger(normalizedCourse) || !Number.isInteger(normalizedGroup)) return null;

  const ranges = STREAM_RANGES[normalizedCourse];
  if (!ranges) return null;
  const match = ranges.find((item) => normalizedGroup >= item.first && normalizedGroup <= item.last);
  if (!match) return null;

  return Object.freeze({
    faculty: 'medicine',
    course: normalizedCourse,
    group: String(normalizedGroup),
    stream: match.stream,
    evidence: match.evidence,
    range: `${match.first}-${match.last}`,
  });
}

export function izhgmuMedicineStreamRanges(course) {
  return STREAM_RANGES[Number(course)] ?? Object.freeze([]);
}
