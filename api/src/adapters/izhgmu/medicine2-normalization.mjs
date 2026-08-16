function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHyphenClockRange(value) {
  const text = norm(value);
  const match = text.match(/^(\d{1,2})-(\d{2})-(\d{1,2})-(\d{2})$/);
  if (!match) return null;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) return null;
  return `${String(startHour).padStart(2, '0')}.${String(startMinute).padStart(2, '0')}-${String(endHour).padStart(2, '0')}.${String(endMinute).padStart(2, '0')}`;
}

function isAssessmentSummary(value) {
  return /^зач[её]ты\s*:/i.test(norm(value));
}

export function normalizeIzhgmuMedicine2ClassStructure(classStructure) {
  if (!classStructure?.sheets) throw new TypeError('IzhGMU class structure is required');
  return {
    ...classStructure,
    sheets: classStructure.sheets.map((sheet) => ({
      ...sheet,
      cells: sheet.cells.map((cell) => {
        if (cell.col !== 2) return cell;
        const normalized = normalizeHyphenClockRange(cell.value);
        if (!normalized) return cell;
        return {
          ...cell,
          value: normalized,
          sourceNormalization: {
            kind: 'izh_medicine2_hyphen_clock_range',
            raw: cell.value,
          },
        };
      }),
    })),
  };
}

export function normalizeIzhgmuMedicine2CompanionForWeekly(lectureStructure) {
  if (!lectureStructure?.sheets) throw new TypeError('IzhGMU lecture structure is required');
  if (lectureStructure.sheets.some((sheet) => sheet.name.toLowerCase().includes('расписание'))) return lectureStructure;
  if (lectureStructure.sheets.length !== 1) return lectureStructure;
  return {
    ...lectureStructure,
    sheets: [{
      ...lectureStructure.sheets[0],
      name: `расписание (${lectureStructure.sheets[0].name})`,
      sourceNormalization: {
        kind: 'izh_medicine2_sole_sheet_companion_alias',
        rawName: lectureStructure.sheets[0].name,
      },
    }],
  };
}

function stripWarning(item, warning) {
  const warnings = (item.warnings || []).filter((value) => value !== warning);
  const next = { ...item, warnings };
  if (next.warning === warning) next.warning = warnings[0] || null;
  if (!warnings.length && next.status === 'needs_review') next.status = 'ok';
  return next;
}

function resolveDeclaredCountRow(item) {
  if (item?.warning !== 'declared_lecture_count_scope_ambiguous') return item;
  if (!Number.isInteger(item.declaredCount) || !Array.isArray(item.dates)) return item;
  if (item.declaredCount !== item.dates.length) return {
    ...item,
    warning: 'declared_lecture_count_mismatch',
    warnings: [...new Set((item.warnings || []).map((value) => (
      value === 'declared_lecture_count_scope_ambiguous' ? 'declared_lecture_count_mismatch' : value
    )))],
    declaredCountScope: 'row',
    ruleIds: [...new Set([...(item.ruleIds || []), 'IZH-M2-03'])],
  };
  const resolved = stripWarning(item, 'declared_lecture_count_scope_ambiguous');
  return {
    ...resolved,
    declaredCountScope: 'row',
    ruleIds: [...new Set([...(resolved.ruleIds || []), 'IZH-M2-03'])],
  };
}

export function normalizeIzhgmuMedicine2Combined(combined) {
  if (combined?.profile !== 'IZH-WEEKLY+LECTURE') throw new TypeError('IZH-WEEKLY+LECTURE result is required');

  const annotations = [];
  const promoted = [];
  const reviewRequired = [];
  for (const sourceItem of combined.reviewRequired || []) {
    if (sourceItem.warning === 'stream_wide_class_block_unmapped'
      && isAssessmentSummary(sourceItem.discipline || sourceItem.rawSource)
      && !sourceItem.weekday && !sourceItem.startTime && !sourceItem.endTime) {
      annotations.push({
        kind: 'assessment_summary',
        value: sourceItem.rawSource || sourceItem.discipline,
        references: sourceItem.references || [],
        ruleIds: [...new Set([...(sourceItem.ruleIds || []), 'IZH-M2-02'])],
      });
      continue;
    }
    const item = resolveDeclaredCountRow(sourceItem);
    if (item.status === 'ok' && !item.warning && !(item.warnings || []).length) promoted.push(item);
    else reviewRequired.push(item);
  }

  const deferred = (combined.deferred || []).filter((item) => !(
    item.reason === 'stream_wide_class_block_unmapped'
    && isAssessmentSummary(item.value || item.rawSource)
    && !item.weekday && !item.startTime && !item.endTime
  ));

  const series = [...(combined.series || []), ...promoted].map(resolveDeclaredCountRow);
  const sourceCoverage = combined.sourceCoverage ? {
    ...combined.sourceCoverage,
    unmapped: (combined.sourceCoverage.unmapped || []).filter((item) => !(
      isAssessmentSummary(item.value)
      && !item.weekday && !item.startTime && !item.endTime
    )),
  } : combined.sourceCoverage;

  return {
    ...combined,
    series,
    reviewRequired,
    deferred,
    sourceCoverage,
    informationalAnnotations: [...(combined.informationalAnnotations || []), ...annotations],
    publishable: reviewRequired.length === 0
      && (combined.unresolvedChoices || []).length === 0
      && deferred.length === 0,
  };
}

export const __medicine2NormalizationTest = {
  normalizeHyphenClockRange,
  isAssessmentSummary,
};
