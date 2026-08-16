import { izhgmuWeeklyLectureBlockers } from './canonical.mjs';

function refs(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function sameRefs(left, right) {
  const a = refs(left);
  const b = refs(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function catalogRefs(block) {
  return refs([...(block?.sourceBlockRefs || []), ...(block?.practiceBlockRefs || [])]);
}

export function assessIzhgmuWeeklyLecturePersonalizationReadiness(parsed, catalog) {
  if (parsed?.profile !== 'IZH-WEEKLY+LECTURE') {
    throw new TypeError('IZH-WEEKLY+LECTURE parsed result is required');
  }
  if (!catalog || Number(catalog.version) !== 1 || !Array.isArray(catalog.electives)) {
    throw new TypeError('version-1 personalization catalog is required');
  }

  const blockers = izhgmuWeeklyLectureBlockers(parsed);
  const unsafeBlockers = blockers.filter((item) => item.warning !== 'elective_choice_required');
  if (unsafeBlockers.length) {
    const error = new Error(`IzhGMU content has ${unsafeBlockers.length} non-personalization blocker(s)`);
    error.code = 'IZH_PERSONALIZATION_CONTENT_BLOCKED';
    error.blockers = unsafeBlockers;
    throw error;
  }

  const choices = parsed.unresolvedChoices || [];
  if (!choices.length || choices.length !== catalog.electives.length) {
    const error = new Error('IzhGMU elective choice/catalog cardinality mismatch');
    error.code = 'IZH_PERSONALIZATION_CHOICE_COUNT_MISMATCH';
    throw error;
  }

  const matchedCatalogIds = new Set();
  for (const choice of choices) {
    if ((choice.warning || 'elective_choice_required') !== 'elective_choice_required') {
      const error = new Error('IzhGMU unresolved choice is not a supported elective choice');
      error.code = 'IZH_PERSONALIZATION_UNSUPPORTED_CHOICE';
      throw error;
    }
    const choiceRefs = refs((choice.blocks || []).map((block) => block.ref));
    if (!choiceRefs.length) {
      const error = new Error('IzhGMU elective choice lacks source block references');
      error.code = 'IZH_PERSONALIZATION_SOURCE_REFS_MISSING';
      throw error;
    }
    const candidates = catalog.electives.filter((block) => sameRefs(catalogRefs(block), choiceRefs));
    if (candidates.length !== 1) {
      const error = new Error(`IzhGMU elective choice does not map uniquely to catalog: ${choiceRefs.join(', ')}`);
      error.code = 'IZH_PERSONALIZATION_CATALOG_MAPPING_AMBIGUOUS';
      error.choiceRefs = choiceRefs;
      throw error;
    }
    const block = candidates[0];
    if (!block.id || matchedCatalogIds.has(block.id) || !Array.isArray(block.options) || block.options.length < 2) {
      const error = new Error('IzhGMU personalization catalog block is incomplete or duplicated');
      error.code = 'IZH_PERSONALIZATION_CATALOG_BLOCK_INVALID';
      throw error;
    }
    for (const option of block.options) {
      if (!option?.id || !option?.officialDiscipline || !Array.isArray(option.events) || option.events.length === 0) {
        const error = new Error(`IzhGMU personalization option is incomplete in ${block.id}`);
        error.code = 'IZH_PERSONALIZATION_CATALOG_OPTION_INVALID';
        throw error;
      }
    }
    matchedCatalogIds.add(block.id);
  }

  if (matchedCatalogIds.size !== catalog.electives.length) {
    const error = new Error('IzhGMU personalization catalog contains an unmatched elective block');
    error.code = 'IZH_PERSONALIZATION_CATALOG_EXTRA_BLOCK';
    throw error;
  }

  return {
    contentReady: true,
    productionAuthorized: false,
    personalizationRequired: true,
    sourceBlockers: blockers,
    electiveBlocks: catalog.electives.length,
    optionCount: catalog.electives.reduce((sum, block) => sum + block.options.length, 0),
  };
}
