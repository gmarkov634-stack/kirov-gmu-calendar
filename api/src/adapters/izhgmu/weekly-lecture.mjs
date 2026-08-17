function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function plusMinutes(clock, minutes) {
  const match = String(clock || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function isCuratorHour(item) {
  return item?.warning === 'end_time_missing_in_source'
    && normalize(item?.discipline).toLowerCase() === 'кураторский час'
    && Boolean(item?.startTime);
}

function resolveCuratorHour(item) {
  const endTime = plusMinutes(item.startTime, 60);
  if (!endTime) return null;
  return {
    ...item,
    endTime,
    status: 'ok',
    warning: null,
    warnings: [],
    ruleIds: [...new Set([...(item.ruleIds || []), 'IZH-W11'])],
    durationPolicy: {
      kind: 'fixed_minutes',
      minutes: 60,
      reason: 'user_policy_curator_hour',
    },
  };
}

export function composeIzhgmuWeeklyLecture({ weeklyParsed, lectureParsed }) {
  if (weeklyParsed?.profile !== 'IZH-WEEKLY') throw new TypeError('IZH-WEEKLY parsed result is required');
  if (lectureParsed?.profile !== 'IZH-LECTURE') throw new TypeError('IZH-LECTURE parsed result is required');
  if (weeklyParsed.period.start_date !== lectureParsed.period.start_date
      || weeklyParsed.period.end_date !== lectureParsed.period.end_date) {
    const error = new Error('IZH weekly/lecture period mismatch');
    error.code = 'IZH_WEEKLY_LECTURE_PERIOD_MISMATCH';
    throw error;
  }

  const resolvedCurator = [];
  const weeklyReviewRequired = [];
  for (const item of weeklyParsed.reviewRequired || []) {
    if (isCuratorHour(item)) {
      const resolved = resolveCuratorHour(item);
      if (resolved) {
        resolvedCurator.push(resolved);
        continue;
      }
    }
    weeklyReviewRequired.push(item);
  }

  const lectureSafe = (lectureParsed.safeSeries || []).map((series) => ({
    ...series,
    group: String(weeklyParsed.group),
  }));
  const reviewRequired = [
    ...weeklyReviewRequired,
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
    series: [...(weeklyParsed.series || []), ...resolvedCurator, ...lectureSafe],
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
