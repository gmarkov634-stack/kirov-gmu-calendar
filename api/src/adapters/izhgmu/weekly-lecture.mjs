export function composeIzhgmuWeeklyLecture({ weeklyParsed, lectureParsed }) {
  if (weeklyParsed?.profile !== 'IZH-WEEKLY') throw new TypeError('IZH-WEEKLY parsed result is required');
  if (lectureParsed?.profile !== 'IZH-LECTURE') throw new TypeError('IZH-LECTURE parsed result is required');
  if (weeklyParsed.period.start_date !== lectureParsed.period.start_date
      || weeklyParsed.period.end_date !== lectureParsed.period.end_date) {
    const error = new Error('IZH weekly/lecture period mismatch');
    error.code = 'IZH_WEEKLY_LECTURE_PERIOD_MISMATCH';
    throw error;
  }

  const lectureSafe = (lectureParsed.safeSeries || []).map((series) => ({
    ...series,
    group: String(weeklyParsed.group),
  }));
  const reviewRequired = [
    ...(weeklyParsed.reviewRequired || []),
    ...(lectureParsed.reviewRequired || []),
  ];
  const unresolvedChoices = lectureParsed.choiceRequired ? [{
    kind: 'elective_choice',
    warning: lectureParsed.choiceRequired.warning,
    ruleIds: lectureParsed.choiceRequired.ruleIds,
    blocks: lectureParsed.choiceRequired.blocks,
    options: lectureParsed.choiceRequired.options,
  }] : [];
  const uncovered = lectureParsed.classCoverage?.unmapped || [];

  return {
    profile: 'IZH-WEEKLY+LECTURE',
    group: String(weeklyParsed.group),
    groups: weeklyParsed.groups,
    period: weeklyParsed.period,
    parity: weeklyParsed.parity,
    series: [...(weeklyParsed.series || []), ...lectureSafe],
    reviewRequired,
    unresolvedChoices,
    deferred: uncovered.map((block) => ({
      ref: block.ref,
      row: block.row,
      value: block.value,
      weekday: block.weekday,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: 'stream_wide_class_block_unmapped',
      ruleIds: ['IZH-L08'],
    })),
    sourceCoverage: lectureParsed.classCoverage,
    lectureStats: lectureParsed.stats,
    publishable: reviewRequired.length === 0 && unresolvedChoices.length === 0 && uncovered.length === 0,
  };
}
