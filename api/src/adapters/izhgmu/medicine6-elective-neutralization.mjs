function normalized(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sourceGroupSpanGroups(parsed) {
  const match = normalized(parsed?.sourceGroupSpan).match(/^(\d{3})\s*[-–]\s*(\d{3})$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end < start || end - start > 20) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function assertCycleChoice(choice) {
  const dates = [...new Set((choice?.dates || []).map(normalized).filter(Boolean))];
  const startTime = normalized(choice?.startTime);
  const endTime = normalized(choice?.endTime);
  if (!dates.length || !startTime || !endTime) {
    const error = new Error('IzhGMU medicine-6 elective slot lacks common exact dates/time');
    error.code = 'IZH_M6_ELECTIVE_NEUTRALIZATION_TIMING_REQUIRED';
    throw error;
  }
  return { dates, startTime, endTime };
}

function neutralCycleSeries(parsed, choice) {
  const timing = assertCycleChoice(choice);
  const group = normalized(parsed.group);
  const jointGroups = sourceGroupSpanGroups(parsed).filter((value) => value !== group);
  return {
    sourceRole: 'class',
    sourceSheet: normalized(parsed.sourceSheet),
    group,
    sourceGroupSpan: normalized(parsed.sourceGroupSpan) || null,
    discipline: 'Дисциплина по выбору',
    disciplineRaw: normalized(choice.disciplineRaw) || normalized(choice.discipline) || 'Дисциплина по выбору',
    lessonType: { raw: 'практические занятия', code: 'practice' },
    dates: timing.dates,
    startTime: timing.startTime,
    endTime: timing.endTime,
    sourceTimeSlots: clone(choice.sourceTimeSlots || []),
    department: null,
    assessment: normalized(choice.assessment) || null,
    location: null,
    jointGroups,
    electiveSlot: Number(choice.slot) || null,
    electiveDisplayPolicy: 'generic_name_no_variant_exposure',
    status: 'ok',
    warning: null,
    warnings: [],
    ruleIds: ['IZH-E01', 'IZH-E02'],
    references: [
      ...(normalized(choice.reference) ? [{ role: 'discipline', range: normalized(choice.reference) }] : []),
      ...(normalized(choice.sectionReference) ? [{ role: 'note', range: normalized(choice.sectionReference) }] : []),
    ],
    rawSource: [
      normalized(choice.disciplineRaw) || normalized(choice.discipline),
      timing.startTime && timing.endTime ? `${timing.startTime}-${timing.endTime}` : null,
      normalized(choice.assessment),
    ].filter(Boolean).join(' | '),
  };
}

export function neutralizeIzhgmuMedicine6CycleElectives(parsed) {
  if (parsed?.profile !== 'IZH-CYCLE' || parsed?.sourceProfile !== 'IZH-CYCLE-MEDICINE6') {
    throw new TypeError('IZH-CYCLE-MEDICINE6 parsed source is required');
  }
  const next = clone(parsed);
  const choices = Array.isArray(next.electiveChoices) ? next.electiveChoices : [];
  const existingSlots = new Set((next.series || []).map((item) => Number(item?.electiveSlot)).filter(Number.isInteger));
  const materialized = choices
    .filter((choice) => !existingSlots.has(Number(choice?.slot)))
    .map((choice) => neutralCycleSeries(next, choice));

  next.series = [...(next.series || []), ...materialized];
  next.reviewRequired = (next.reviewRequired || []).filter((item) => item?.warning !== 'elective_choice_required');
  next.publishable = next.reviewRequired.length === 0;
  next.electiveDisplayPolicy = {
    displayName: 'Дисциплина по выбору',
    distinguishVariants: false,
    variantNamesRetainedOnlyAsSourceEvidence: true,
    cycleTimingCommonAcrossVariants: true,
  };
  return next;
}

export function neutralizeIzhgmuMedicine6LectureElectiveNames(parsed) {
  if (parsed?.profile !== 'IZH-LECTURE-MEDICINE6') {
    throw new TypeError('IZH-LECTURE-MEDICINE6 parsed source is required');
  }
  const next = clone(parsed);
  const normalizeSeries = (item) => {
    if (!item?.choiceRequired && !Number.isInteger(Number(item?.electiveSlot))) return item;
    return {
      ...item,
      discipline: 'Дисциплина по выбору',
      electiveDisplayPolicy: 'generic_name_no_variant_exposure',
    };
  };
  next.series = (next.series || []).map(normalizeSeries);
  next.electiveSeries = (next.electiveSeries || []).map(normalizeSeries);
  next.electiveDisplayPolicy = {
    displayName: 'Дисциплина по выбору',
    distinguishVariants: false,
    variantNamesRetainedOnlyAsSourceEvidence: true,
    scheduleVariantsRemainDeferredWhenDatesOrTimesDiffer: true,
  };
  return next;
}
