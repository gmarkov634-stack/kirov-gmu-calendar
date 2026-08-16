import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const outputPath = path.resolve(arg('--output', path.join(inputDir, 'medicine3-time-resolution.json')));

const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const low = (value) => norm(value).toLowerCase().replace(/ё/g, 'е');

const DISCIPLINE_MAP = [
  [/^фармак/, 'Фармакология'],
  [/стомат/, 'Стоматология'],
  [/патофиз/, 'Патофизиология'],
  [/общ.*хир/, 'Общая хирургия'],
  [/^озз$|обществен.*здоров|организац.*здоров/, 'Общественное здоровье и здравоохранение'],
  [/пат.*анатом/, 'Патологическая анатомия'],
  [/пр.*вн.*бол|пропед.*внут/, 'Пропедевтика внутренних болезней'],
];

function canonicalDiscipline(value) {
  const text = low(value).replace(/[.]/g, '');
  return DISCIPLINE_MAP.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function normalizeClock(value) {
  const match = norm(value).match(/^(\d{1,2})[.:](\d{2})$/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : null;
}

function clockRange(value) {
  const match = norm(value).match(/^(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})$/);
  if (!match) return null;
  const start = normalizeClock(match[1]);
  const end = normalizeClock(match[2]);
  return start && end ? { start, end } : null;
}

function cycleTimeVariants(value) {
  const match = norm(value).match(/^(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})\s*\((\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})\)$/);
  if (!match) return null;
  const primary = clockRange(match[1]);
  const afterMorningLecture = clockRange(match[2]);
  return primary && afterMorningLecture ? { primary, afterMorningLecture } : null;
}

function groupsForPair(pair) {
  return (pair.groups || []).map(String);
}

function seriesAt(pair, discipline, date) {
  return (pair.series || []).filter((series) => (
    series.discipline === discipline && (series.dates || []).includes(date)
  ));
}

function blocker(kind, input = {}) {
  return { kind, ...input };
}

function stableKey(item) {
  return JSON.stringify([
    item.kind,
    item.group ?? null,
    item.discipline ?? null,
    item.date ?? null,
    item.reference ?? null,
    item.references ?? null,
  ]);
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = stableKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const cycle = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-legacy-cycle.json'), 'utf8'));
const audience = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-lecture-audience.json'), 'utf8'));

if (cycle.parserVersion !== 'izhgmu-medicine3-legacy-cycle-v2') {
  throw new Error(`IZH-M3 cycle parser v2 required, got ${cycle.parserVersion}`);
}
if (audience.verifierVersion !== 'izhgmu-medicine3-lecture-audience-v1') {
  throw new Error(`IZH-M3 lecture audience v1 required, got ${audience.verifierVersion}`);
}

const russianPairs = cycle.groupPairs || [];
const expectedPairs = Array.from({ length: 13 }, (_, index) => `${301 + index * 2}-${302 + index * 2}`);
if (russianPairs.map((pair) => pair.groupSpan).join('|') !== expectedPairs.join('|')) {
  throw new Error('IZH-M3 Russian group-pair invariant changed');
}

const groupToPair = new Map();
for (const pair of russianPairs) {
  for (const group of groupsForPair(pair)) {
    if (groupToPair.has(group)) throw new Error(`IZH-M3 duplicate group ${group}`);
    groupToPair.set(group, pair);
  }
}
if (groupToPair.size !== 26) throw new Error(`IZH-M3 expected 26 Russian groups, got ${groupToPair.size}`);

const sourceDiagnostics = audience.unresolved || [];
const ordinaryRowCountDiagnostics = sourceDiagnostics.filter((item) => item.kind === 'lecture_count_mismatch');
const structuralDiagnostics = sourceDiagnostics.filter((item) => item.kind !== 'lecture_count_mismatch');

// The ordinary lecture count column is repeated on each weekday row and is not row-cardinality authority.
// Exact lecture dates still come only from populated date cells and audience is resolved by cycle/date intersection.
const nonBlockingDiagnostics = ordinaryRowCountDiagnostics.map((item) => ({
  ...item,
  disposition: 'source_metadata_only',
  ruleId: 'IZH-C3-16',
}));

const resolvedGroups = {};
for (const [group, pair] of [...groupToPair.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const groupLectureItems = audience.perRussianGroup?.[group] || [];
  const ordinaryLectures = groupLectureItems.filter((item) => item.kind === 'ordinary_lecture');
  const physicalEducation = groupLectureItems.filter((item) => item.kind === 'physical_culture');
  const blockers = [];
  const practiceEvents = [];
  const lectureEvents = [];

  const ordinaryIndex = new Map();
  for (const item of ordinaryLectures) {
    const key = `${item.discipline}\u0000${item.date}`;
    if (!ordinaryIndex.has(key)) ordinaryIndex.set(key, []);
    ordinaryIndex.get(key).push(item);
  }

  for (const series of pair.series || []) {
    const variants = cycleTimeVariants(series.timeRaw);
    if (!variants) {
      blockers.push(blocker('medicine3_cycle_time_format_unreviewed', {
        group,
        discipline: series.discipline,
        reference: series.refs?.time ?? null,
        raw: series.timeRaw ?? null,
      }));
      continue;
    }
    if (variants.afterMorningLecture.start !== '10:15') {
      blockers.push(blocker('medicine3_parenthesized_time_semantics_changed', {
        group,
        discipline: series.discipline,
        reference: series.refs?.time ?? null,
        raw: series.timeRaw ?? null,
      }));
      continue;
    }

    for (const date of series.dates || []) {
      const key = `${series.discipline}\u0000${date}`;
      const matchingLectures = ordinaryIndex.get(key) || [];
      if (matchingLectures.length > 1) {
        blockers.push(blocker('medicine3_multiple_lectures_same_cycle_date', {
          group,
          discipline: series.discipline,
          date,
          references: matchingLectures.map((item) => item.ref),
        }));
        continue;
      }

      const matchingLecture = matchingLectures[0] || null;
      let time = variants.primary;
      let timeMode = 'primary_cycle_interval';
      let lectureReference = null;

      if (matchingLecture) {
        const lectureRange = clockRange(matchingLecture.time);
        lectureReference = matchingLecture.ref;
        if (!lectureRange) {
          blockers.push(blocker('medicine3_lecture_time_format_unreviewed', {
            group,
            discipline: series.discipline,
            date,
            reference: matchingLecture.ref,
            raw: matchingLecture.time,
          }));
          continue;
        }
        if (lectureRange.start === '08:30' && lectureRange.end === '10:05') {
          time = variants.afterMorningLecture;
          timeMode = 'after_same_cycle_morning_lecture';
        } else if (
          series.discipline === 'Стоматология'
          && lectureRange.start === '11:20'
          && lectureRange.end === '12:50'
        ) {
          // Preserve both source facts, but do not invent an 11:05 practice end, split the practice,
          // or remove the lecture. The exact sources overlap and do not explain the intended resolution.
          time = variants.primary;
          timeMode = 'source_overlap_unresolved_stomatology';
          blockers.push(blocker('medicine3_stomatology_practice_lecture_overlap_unresolved', {
            group,
            discipline: series.discipline,
            date,
            practiceStart: variants.primary.start,
            practiceEnd: variants.primary.end,
            lectureStart: lectureRange.start,
            lectureEnd: lectureRange.end,
            references: [series.refs?.time ?? null, matchingLecture.ref].filter(Boolean),
          }));
        } else {
          blockers.push(blocker('medicine3_cycle_lecture_slot_unreviewed', {
            group,
            discipline: series.discipline,
            date,
            reference: matchingLecture.ref,
            raw: matchingLecture.time,
          }));
          continue;
        }
      }

      practiceEvents.push({
        sourceRole: 'cycle_practice',
        group,
        sourceGroupSpan: pair.groupSpan,
        jointGroups: groupsForPair(pair).filter((value) => value !== group),
        discipline: series.discipline,
        date,
        startTime: time.start,
        endTime: time.end,
        timeMode,
        department: series.department ?? null,
        location: series.location ?? null,
        assessment: series.assessment ?? null,
        sourceRanges: series.sourceRanges || [],
        timeReference: series.refs?.time ?? null,
        lectureReference,
        ruleIds: ['IZH-C3-01', 'IZH-C3-02', 'IZH-C3-07', 'IZH-C3-13'],
      });
    }
  }

  for (const item of ordinaryLectures) {
    const range = clockRange(item.time);
    if (!range) {
      blockers.push(blocker('medicine3_lecture_time_format_unreviewed', {
        group,
        discipline: item.discipline,
        date: item.date,
        reference: item.ref,
        raw: item.time,
      }));
      continue;
    }
    lectureEvents.push({
      sourceRole: 'lecture',
      group,
      discipline: item.discipline,
      date: item.date,
      startTime: range.start,
      endTime: range.end,
      location: item.location ?? null,
      sourceReference: item.ref,
      ruleIds: ['IZH-C3-14'],
    });
  }

  for (const item of physicalEducation) {
    const range = clockRange(item.time);
    if (!range || range.start !== '16:35' || range.end !== '18:00') {
      blockers.push(blocker('medicine3_physical_education_slot_unreviewed', {
        group,
        discipline: 'Физическая культура и спорт',
        date: item.date,
        reference: item.ref,
        raw: item.time,
      }));
      continue;
    }
    lectureEvents.push({
      sourceRole: 'physical_education',
      group,
      discipline: 'Физическая культура и спорт',
      date: item.date,
      startTime: range.start,
      endTime: range.end,
      location: item.location ?? null,
      sourceReference: item.ref,
      ruleIds: ['IZH-C3-15'],
    });
  }

  // Scope structural lecture diagnostics to Russian groups only when the bad source fact intersects
  // that group's exact current cycle discipline/date. English-only defects remain diagnostics, not Russian blockers.
  for (const diagnostic of structuralDiagnostics) {
    if (diagnostic.kind === 'lecture_date_weekday_mismatch') {
      const discipline = canonicalDiscipline(diagnostic.disciplineRaw);
      if (!discipline || !diagnostic.date) continue;
      if (seriesAt(pair, discipline, diagnostic.date).length === 1) {
        blockers.push(blocker('medicine3_lecture_weekday_mismatch', {
          group,
          discipline,
          date: diagnostic.date,
          reference: diagnostic.ref ?? diagnostic.sourceRef ?? null,
          sourceWeekday: diagnostic.sourceWeekday ?? null,
        }));
      }
      continue;
    }
    if (diagnostic.kind === 'lecture_audience_no_cycle_match') continue;
    blockers.push(blocker('medicine3_unresolved_lecture_source', {
      group,
      discipline: canonicalDiscipline(diagnostic.disciplineRaw) ?? diagnostic.disciplineRaw ?? null,
      date: diagnostic.date ?? null,
      reference: diagnostic.ref ?? diagnostic.sourceRef ?? null,
      sourceKind: diagnostic.kind,
    }));
  }

  if (practiceEvents.length !== 92) {
    blockers.push(blocker('medicine3_practice_coverage_changed', {
      group,
      expected: 92,
      actual: practiceEvents.length,
    }));
  }
  if (physicalEducation.length !== 30) {
    blockers.push(blocker('medicine3_physical_education_coverage_changed', {
      group,
      expected: 30,
      actual: physicalEducation.length,
    }));
  }

  const finalBlockers = unique(blockers);
  resolvedGroups[group] = {
    group,
    sourceGroupSpan: pair.groupSpan,
    contentReady: finalBlockers.length === 0,
    blockers: finalBlockers,
    stats: {
      practiceEvents: practiceEvents.length,
      shiftedPracticeEvents: practiceEvents.filter((event) => event.timeMode === 'after_same_cycle_morning_lecture').length,
      unresolvedStomatologyOverlapEvents: practiceEvents.filter((event) => event.timeMode === 'source_overlap_unresolved_stomatology').length,
      ordinaryLectureEvents: ordinaryLectures.length,
      physicalEducationEvents: physicalEducation.length,
      totalEvents: practiceEvents.length + lectureEvents.length,
    },
    practiceEvents,
    lectureEvents,
  };
}

const groups = Object.values(resolvedGroups);
const readyGroups = groups.filter((item) => item.contentReady).map((item) => item.group);
const blockedGroups = groups.filter((item) => !item.contentReady).map((item) => item.group);
const blockerKinds = {};
for (const item of groups.flatMap((group) => group.blockers)) {
  blockerKinds[item.kind] = (blockerKinds[item.kind] || 0) + 1;
}

const result = {
  profile: 'IZH-MEDICINE3-TIME-RESOLUTION',
  version: 1,
  inputs: {
    cycleParserVersion: cycle.parserVersion,
    lectureAudienceVersion: audience.verifierVersion,
    cycleSource: cycle.source,
    lectureSource: audience.source,
  },
  policy: {
    primary: 'Use first cycle interval from lower source legend.',
    afterMorningLecture: 'Use parenthesized cycle interval only when exact same-group same-discipline same-date lecture is 08:30-10:05.',
    laterStomatologyLecture: 'Exact 11:20-12:50 Stomatology lecture overlaps the source primary practice interval; preserve both facts and fail closed until an explicit source-specific resolution exists.',
    countColumn: 'Ordinary lecture printed count is source_metadata_only and never creates/deletes dates.',
    productionAuthorized: false,
  },
  nonBlockingDiagnostics,
  groups: resolvedGroups,
  stats: {
    groupCount: groups.length,
    contentReadyGroupCount: readyGroups.length,
    blockedGroupCount: blockedGroups.length,
    readyGroups,
    blockedGroups,
    blockerKinds,
    ordinaryCountDiagnostics: nonBlockingDiagnostics.length,
    productionAuthorized: false,
  },
};

await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log('IZHGMU_MEDICINE3_TIME_RESOLUTION', JSON.stringify(result.stats));
for (const group of groups) {
  console.log('IZHGMU_MEDICINE3_GROUP', JSON.stringify({
    group: group.group,
    contentReady: group.contentReady,
    ...group.stats,
    blockers: group.blockers,
  }));
}
