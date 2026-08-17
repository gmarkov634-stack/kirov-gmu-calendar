import { buildIzhgmuMedicine3CompositeCandidate } from './medicine3-composite.mjs';

const EXCLUDED_DISCIPLINE = 'Стоматология';
const EXCLUDED_BLOCKER_KIND = 'medicine3_stomatology_practice_lecture_overlap_unresolved';
const EXCLUSION_CONTRACT = Object.freeze({
  practiceEvents: 8,
  lectureEvents: 7,
  blockers: 7,
  totalEvents: 15,
});

function disciplineOfEvent(event) {
  return String(event?.lesson?.discipline?.normalized || '').trim();
}

function eventType(event) {
  return String(event?.lesson?.type?.code || '').trim();
}

function exclusionContractError(group, detail) {
  const error = new Error(`IzhGMU medicine-3 Stomatology exclusion contract changed for group ${group}: ${detail}`);
  error.code = 'IZH_M3_STOMATOLOGY_EXCLUSION_CONTRACT_CHANGED';
  error.group = group;
  return error;
}

export function buildIzhgmuMedicine3PublicationCandidate(input = {}) {
  const composite = buildIzhgmuMedicine3CompositeCandidate(input);
  const excludedEvents = composite.batch.events.filter((event) => disciplineOfEvent(event) === EXCLUDED_DISCIPLINE);
  const excludedPracticeEvents = excludedEvents.filter((event) => eventType(event) === 'practice');
  const excludedLectureEvents = excludedEvents.filter((event) => eventType(event) === 'lecture');
  const excludedBlockers = composite.blockers.filter((blocker) => (
    blocker?.kind === EXCLUDED_BLOCKER_KIND && blocker?.discipline === EXCLUDED_DISCIPLINE
  ));
  const unexpectedStomatologyBlockers = composite.blockers.filter((blocker) => (
    blocker?.discipline === EXCLUDED_DISCIPLINE && blocker?.kind !== EXCLUDED_BLOCKER_KIND
  ));

  if (unexpectedStomatologyBlockers.length) {
    throw exclusionContractError(composite.group, `unexpected blocker kinds: ${[
      ...new Set(unexpectedStomatologyBlockers.map((item) => item.kind)),
    ].join(', ')}`);
  }
  if (excludedPracticeEvents.length !== EXCLUSION_CONTRACT.practiceEvents) {
    throw exclusionContractError(composite.group, `practice events ${excludedPracticeEvents.length}/${EXCLUSION_CONTRACT.practiceEvents}`);
  }
  if (excludedLectureEvents.length !== EXCLUSION_CONTRACT.lectureEvents) {
    throw exclusionContractError(composite.group, `lecture events ${excludedLectureEvents.length}/${EXCLUSION_CONTRACT.lectureEvents}`);
  }
  if (excludedEvents.length !== EXCLUSION_CONTRACT.totalEvents) {
    throw exclusionContractError(composite.group, `total events ${excludedEvents.length}/${EXCLUSION_CONTRACT.totalEvents}`);
  }
  if (excludedBlockers.length !== EXCLUSION_CONTRACT.blockers) {
    throw exclusionContractError(composite.group, `blockers ${excludedBlockers.length}/${EXCLUSION_CONTRACT.blockers}`);
  }

  const events = composite.batch.events.filter((event) => disciplineOfEvent(event) !== EXCLUDED_DISCIPLINE);
  const blockers = composite.blockers.filter((blocker) => !excludedBlockers.includes(blocker));

  return {
    profile: 'IZH-MEDICINE3-PUBLICATION-CANDIDATE',
    version: 1,
    group: composite.group,
    stream: composite.stream,
    publishable: blockers.length === 0,
    blockers,
    exclusion: {
      ruleId: 'IZH-C3-18',
      temporary: true,
      discipline: EXCLUDED_DISCIPLINE,
      reason: 'Official class and lecture sources overlap without an authoritative source rule that resolves the Stomatology practice/lecture collision.',
      failClosedOnContractChange: true,
      removed: {
        practiceEvents: excludedPracticeEvents.length,
        lectureEvents: excludedLectureEvents.length,
        totalEvents: excludedEvents.length,
        blockers: excludedBlockers.length,
      },
    },
    componentStats: {
      ...composite.componentStats,
      rawTotalEvents: composite.batch.events.length,
      excludedEvents: excludedEvents.length,
      totalEvents: events.length,
      rawBlockers: composite.blockers.length,
      excludedBlockers: excludedBlockers.length,
      blockers: blockers.length,
    },
    batch: {
      ...composite.batch,
      schedule: {
        ...composite.batch.schedule,
        parser: 'izhgmu-medicine3-publication-v1-qa-candidate',
      },
      events,
    },
  };
}

export function assertIzhgmuMedicine3PublicationComplete(input = {}) {
  const candidate = buildIzhgmuMedicine3PublicationCandidate(input);
  if (candidate.blockers.length) {
    const error = new Error(`IzhGMU medicine-3 publication candidate is incomplete for group ${candidate.group}: ${candidate.blockers.length} blocker(s)`);
    error.code = 'IZH_M3_PUBLICATION_INCOMPLETE';
    error.group = candidate.group;
    error.blockers = candidate.blockers;
    throw error;
  }
  return candidate;
}

export function buildIzhgmuMedicine3PublicationCanonicalBatch(input = {}) {
  const candidate = assertIzhgmuMedicine3PublicationComplete(input);
  return {
    ...candidate.batch,
    schedule: {
      ...candidate.batch.schedule,
      parser: 'izhgmu-medicine3-publication-v1',
    },
  };
}
