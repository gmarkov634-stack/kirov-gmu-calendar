function normalized(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return normalized(value).toLowerCase().replace(/ё/g, 'е');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function electiveSeries(parsed) {
  return (parsed?.series || []).filter((item) => item?.choiceRequired === true);
}

function selectedSeries(parsed, discipline) {
  const target = key(discipline);
  return electiveSeries(parsed).filter((item) => key(item?.discipline) === target);
}

function makeSelected(item) {
  const next = clone(item);
  next.choiceRequired = false;
  next.status = 'ok';
  next.warning = null;
  next.warnings = (next.warnings || []).filter((warning) => warning !== 'elective_choice_required');
  next.ruleIds = [...new Set([...(next.ruleIds || []), 'IZH-P01'])];
  next.personalization = {
    kind: 'elective',
    state: 'selected',
    officialDiscipline: normalized(next.discipline),
  };
  return next;
}

export function personalizeIzhgmuWeeklyLectureElective(parsed, { selectedDiscipline = null } = {}) {
  if (parsed?.profile !== 'IZH-LECTURE') {
    throw new TypeError('IZH-LECTURE parsed source is required');
  }

  const next = clone(parsed);
  const available = [...new Set(electiveSeries(next).map((item) => normalized(item.discipline)).filter(Boolean))];
  const selected = normalized(selectedDiscipline);

  if (!selected) {
    next.safeSeries = (next.safeSeries || []).map(clone);
    next.choiceRequired = null;
    next.personalization = {
      elective: {
        state: 'unselected',
        displayPolicy: 'hidden_until_selected',
        availableOfficialDisciplines: available,
      },
    };
    return next;
  }

  const matches = selectedSeries(next, selected);
  if (!matches.length) {
    const error = new Error(`IzhGMU elective discipline is not present in the official source: ${selected}`);
    error.code = 'IZH_ELECTIVE_SELECTION_NOT_IN_SOURCE';
    error.selectedDiscipline = selected;
    error.availableOfficialDisciplines = available;
    throw error;
  }

  const unsafe = matches.filter((item) => item.status === 'needs_review'
    || (item.warnings || []).some((warning) => warning !== 'elective_choice_required'));
  if (unsafe.length) {
    const error = new Error(`IzhGMU selected elective has unresolved source warnings: ${selected}`);
    error.code = 'IZH_ELECTIVE_SELECTION_SOURCE_UNSAFE';
    error.selectedDiscipline = selected;
    error.warnings = [...new Set(unsafe.flatMap((item) => item.warnings || []))];
    throw error;
  }

  const materialized = matches.map(makeSelected);
  next.safeSeries = [...(next.safeSeries || []).map(clone), ...materialized];
  next.choiceRequired = null;
  next.personalization = {
    elective: {
      state: 'selected',
      displayPolicy: 'official_name',
      selectedOfficialDiscipline: normalized(matches[0].discipline),
      availableOfficialDisciplines: available,
      materializedSeriesCount: materialized.length,
      materializedOccurrenceCount: materialized.reduce((count, item) => count + (item.dates || []).length, 0),
    },
  };
  return next;
}
