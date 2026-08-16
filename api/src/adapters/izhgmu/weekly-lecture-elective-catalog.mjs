import { createHash } from 'node:crypto';
import { buildIzhgmuWeeklyLectureQaCandidate } from './canonical.mjs';
import { prepareSchedulePublication } from '../../schedule/pipeline.js';

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return norm(value).toLowerCase().replace(/ё/g, 'е');
}

function slug(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function cleanedElectiveSeries(series) {
  const next = structuredClone(series);
  next.choiceRequired = false;
  next.status = 'ok';
  next.warning = null;
  next.warnings = (next.warnings || []).filter((warning) => warning !== 'elective_choice_required');
  next.ruleIds = [...new Set([...(next.ruleIds || []), 'IZH-ELECTIVE-PERSONALIZATION'])];
  return next;
}

function groupByDiscipline(series) {
  const result = new Map();
  for (const item of series) {
    const disciplineKey = key(item.discipline);
    if (!disciplineKey) continue;
    if (!result.has(disciplineKey)) result.set(disciplineKey, []);
    result.get(disciplineKey).push(item);
  }
  return result;
}

function assertChoiceSource(weeklyParsed, lectureParsed) {
  if (weeklyParsed?.profile !== 'IZH-WEEKLY') throw new TypeError('IZH-WEEKLY parsed source is required');
  if (lectureParsed?.profile !== 'IZH-LECTURE') throw new TypeError('IZH-LECTURE parsed source is required');
  const blocks = lectureParsed.choiceRequired?.blocks || [];
  if (!blocks.length) return [];
  for (const block of blocks) {
    if (!block.slotKey || !block.ref) {
      const error = new Error('IzhGMU elective class block lacks source-bound slot identity');
      error.code = 'IZH_ELECTIVE_BLOCK_IDENTITY_MISSING';
      throw error;
    }
  }
  return blocks;
}

export function buildIzhgmuWeeklyLectureElectiveCatalog({
  weeklyParsed,
  lectureParsed,
  metadata,
  source,
  now = '2026-08-16T00:00:00.000Z',
} = {}) {
  const blocks = assertChoiceSource(weeklyParsed, lectureParsed);
  if (!blocks.length) return { version: 1, electives: [] };

  const allChoices = (lectureParsed.series || []).filter((item) => item.choiceRequired === true);
  const catalogBlocks = blocks
    .slice()
    .sort((a, b) => Number(a.row || 0) - Number(b.row || 0))
    .map((block, blockIndex) => {
      const matching = allChoices.filter((item) => item.slotKey === block.slotKey);
      if (!matching.length) {
        const error = new Error(`IzhGMU elective block has no lecture alternatives: ${block.ref}`);
        error.code = 'IZH_ELECTIVE_BLOCK_OPTIONS_MISSING';
        throw error;
      }
      const unsafe = matching.filter((item) => (
        item.status === 'needs_review'
        || (item.warnings || []).some((warning) => warning !== 'elective_choice_required')
      ));
      if (unsafe.length) {
        const error = new Error(`IzhGMU elective block contains unsafe alternatives: ${block.ref}`);
        error.code = 'IZH_ELECTIVE_BLOCK_OPTION_UNSAFE';
        error.blockRef = block.ref;
        throw error;
      }

      const grouped = groupByDiscipline(matching);
      const options = [...grouped.values()].map((items) => {
        const officialDiscipline = norm(items[0].discipline);
        const optionId = `opt-${slug(`${block.ref}|${officialDiscipline}`)}`;
        const selectedSeries = items.map(cleanedElectiveSeries);
        const parsed = {
          profile: 'IZH-WEEKLY+LECTURE',
          group: String(weeklyParsed.group),
          groups: weeklyParsed.groups,
          period: weeklyParsed.period,
          parity: weeklyParsed.parity,
          series: selectedSeries,
          reviewRequired: [],
          unresolvedChoices: [],
          deferred: [],
          publishable: true,
        };
        const batch = buildIzhgmuWeeklyLectureQaCandidate({ parsed, metadata, source });
        let counter = 0;
        const stable = slug(`${metadata.groupCode}|${block.ref}|${officialDiscipline}`);
        const prepared = prepareSchedulePublication(batch, {
          now,
          eventIdFactory: () => `evt_izh_el_${stable}_${++counter}`,
          versionIdFactory: () => `ver_izh_el_${stable}`,
        });
        if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
          const error = new Error(`IzhGMU elective option failed canonical QA: ${officialDiscipline}`);
          error.code = 'IZH_ELECTIVE_OPTION_QA_FAILED';
          throw error;
        }
        return {
          id: optionId,
          officialDiscipline,
          sourceBlockRef: block.ref,
          sourceSlotKey: block.slotKey,
          events: prepared.batch.events,
        };
      });

      return {
        id: `elective-${blockIndex + 1}-${slug(block.ref)}`,
        label: norm(block.value) || `Дисциплина по выбору ${blockIndex + 1}`,
        sourceBlockRef: block.ref,
        sourceSlotKey: block.slotKey,
        options,
      };
    });

  return {
    version: 1,
    university: 'izhgmu',
    academicYear: metadata.academicYear,
    semester: metadata.semester,
    facultyCode: metadata.facultyCode,
    course: Number(metadata.course),
    groupCode: String(metadata.groupCode),
    electives: catalogBlocks,
  };
}
