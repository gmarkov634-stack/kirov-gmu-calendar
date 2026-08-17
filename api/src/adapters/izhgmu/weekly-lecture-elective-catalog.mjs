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
    if (!block.slotKey || !block.ref || !Number.isInteger(block.weekday) || !block.startTime || !block.endTime) {
      const error = new Error('IzhGMU elective class block lacks source-bound slot identity');
      error.code = 'IZH_ELECTIVE_BLOCK_IDENTITY_MISSING';
      throw error;
    }
  }
  return blocks;
}

function dateValue(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function dateIso(value) {
  return value.toISOString().slice(0, 10);
}

function datesForWeekday(period, weekday) {
  const start = dateValue(period?.start_date);
  const end = dateValue(period?.end_date);
  if (!start || !end || end < start || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    const error = new Error('IzhGMU elective practice period is invalid');
    error.code = 'IZH_ELECTIVE_PRACTICE_PERIOD_INVALID';
    throw error;
  }
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const jsDay = cursor.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    if (isoDay === weekday) dates.push(dateIso(cursor));
  }
  return dates;
}

function practiceBlock(block) {
  return /практические\s+занятия\s+по\s+ДВ(?=$|[\s;,:().])/i.test(norm(block?.value));
}

function practiceSeries(block, discipline, weeklyParsed) {
  const dates = datesForWeekday(weeklyParsed.period, block.weekday);
  if (!dates.length) {
    const error = new Error(`IzhGMU elective practice block has no dates: ${block.ref}`);
    error.code = 'IZH_ELECTIVE_PRACTICE_DATES_MISSING';
    throw error;
  }
  return {
    sourceRole: 'class',
    sourceSheet: 'расписание',
    discipline,
    weekday: block.weekday,
    weekdayLabel: block.weekdayLabel || null,
    startTime: block.startTime,
    endTime: block.endTime,
    location: null,
    parity: 'weekly_declared',
    dates,
    declaredCount: null,
    declaredCountScope: null,
    lessonType: { raw: 'практические занятия', code: 'practice' },
    slotKey: block.slotKey,
    classTimeReference: block.timeReference || null,
    choiceRequired: false,
    status: 'ok',
    warning: null,
    warnings: [],
    ruleIds: ['IZH-ELECTIVE-PERSONALIZATION', 'IZH-ELECTIVE-PRACTICE-SOURCE'],
    references: [
      { role: 'discipline', range: `расписание!${block.ref}` },
      ...(block.timeReference ? [{ role: 'time', range: `расписание!${block.timeReference}` }] : []),
    ],
    rawSource: norm(block.value),
  };
}

function logicalChoiceBlocks(blocks, allChoices) {
  const choiceSlotKeys = new Set(allChoices.map((item) => item.slotKey).filter(Boolean));
  const optionBlocks = blocks.filter((block) => choiceSlotKeys.has(block.slotKey));
  const practicalBlocks = blocks.filter((block) => !choiceSlotKeys.has(block.slotKey) && practiceBlock(block));
  const unknownBlocks = blocks.filter((block) => !choiceSlotKeys.has(block.slotKey) && !practiceBlock(block));

  if (unknownBlocks.length) {
    const error = new Error(`IzhGMU elective blocks cannot be assigned safely: ${unknownBlocks.map((item) => item.ref).join(', ')}`);
    error.code = 'IZH_ELECTIVE_BLOCK_ROLE_AMBIGUOUS';
    error.blockRefs = unknownBlocks.map((item) => item.ref);
    throw error;
  }

  const bySlot = new Map();
  for (const block of optionBlocks) {
    if (!bySlot.has(block.slotKey)) bySlot.set(block.slotKey, []);
    bySlot.get(block.slotKey).push(block);
  }
  const logical = [...bySlot.entries()].map(([slotKey, sourceBlocks]) => ({
    slotKey,
    sourceBlocks: sourceBlocks.slice().sort((a, b) => Number(a.row || 0) - Number(b.row || 0)),
    practicalBlocks: [],
  }));

  for (const block of practicalBlocks) {
    const candidates = logical.filter((item) => item.sourceBlocks.some((sourceBlock) => sourceBlock.weekday === block.weekday));
    if (candidates.length !== 1) {
      const error = new Error(`IzhGMU elective practice block cannot be uniquely mapped: ${block.ref}`);
      error.code = 'IZH_ELECTIVE_PRACTICE_MAPPING_AMBIGUOUS';
      error.blockRef = block.ref;
      throw error;
    }
    candidates[0].practicalBlocks.push(block);
  }

  return logical;
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
  if (!allChoices.length) {
    const error = new Error('IzhGMU elective blocks have no lecture alternatives');
    error.code = 'IZH_ELECTIVE_BLOCK_OPTIONS_MISSING';
    throw error;
  }

  const logicalBlocks = logicalChoiceBlocks(blocks, allChoices);
  const catalogBlocks = logicalBlocks.map((logicalBlock, blockIndex) => {
    const matching = allChoices.filter((item) => item.slotKey === logicalBlock.slotKey);
    if (!matching.length) {
      const error = new Error(`IzhGMU elective block has no lecture alternatives: ${logicalBlock.sourceBlocks[0]?.ref || logicalBlock.slotKey}`);
      error.code = 'IZH_ELECTIVE_BLOCK_OPTIONS_MISSING';
      throw error;
    }
    const unsafe = matching.filter((item) => (
      item.status === 'needs_review'
      || (item.warnings || []).some((warning) => warning !== 'elective_choice_required')
    ));
    if (unsafe.length) {
      const error = new Error(`IzhGMU elective block contains unsafe alternatives: ${logicalBlock.sourceBlocks[0]?.ref || logicalBlock.slotKey}`);
      error.code = 'IZH_ELECTIVE_BLOCK_OPTION_UNSAFE';
      error.blockRef = logicalBlock.sourceBlocks[0]?.ref || null;
      throw error;
    }

    const sourceRefs = logicalBlock.sourceBlocks.map((item) => item.ref).sort();
    const grouped = groupByDiscipline(matching);
    const options = [...grouped.values()].map((items) => {
      const officialDiscipline = norm(items[0].discipline);
      const optionId = `opt-${slug(`${sourceRefs.join('|')}|${officialDiscipline}`)}`;
      const selectedSeries = [
        ...items.map(cleanedElectiveSeries),
        ...logicalBlock.practicalBlocks.map((block) => practiceSeries(block, officialDiscipline, weeklyParsed)),
      ];
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
      const stable = slug(`${metadata.groupCode}|${sourceRefs.join('|')}|${officialDiscipline}`);
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
        sourceBlockRefs: sourceRefs,
        sourceSlotKey: logicalBlock.slotKey,
        practiceBlockRefs: logicalBlock.practicalBlocks.map((item) => item.ref).sort(),
        events: prepared.batch.events,
      };
    });

    return {
      id: `elective-${blockIndex + 1}-${slug(sourceRefs.join('|'))}`,
      label: `Дисциплина по выбору ${blockIndex + 1}`,
      sourceBlockRefs: sourceRefs,
      sourceSlotKey: logicalBlock.slotKey,
      practiceBlockRefs: logicalBlock.practicalBlocks.map((item) => item.ref).sort(),
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
