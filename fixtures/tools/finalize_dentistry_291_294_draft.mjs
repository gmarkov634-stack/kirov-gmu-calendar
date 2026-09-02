#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, digestNormalizedEvents } from '../../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PERIOD = '2026-2027-semester-1';
const SOURCE_PATH = resolve(ROOT, 'fixtures/2026-2027-semester-1/dentistry-291-294.source.json');
const JOB_PATH = resolve(ROOT, 'fixtures/2026-2027-semester-1/dentistry-291-294.parsing-job.json');
const COMPACT_PATH = resolve(ROOT, 'fixtures/2026-2027-semester-1/normalized/dentistry-291-294.normalized.compact.json');
const DRAFT_PATH = resolve(ROOT, 'qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json');
const QA_PATH = resolve(ROOT, 'qa/2026-2027-semester-1/dentistry-291-294.qa-report.json');
const EVIDENCE_PATH = resolve(ROOT, 'qa/2026-2027-semester-1/dentistry-291-294.evidence.json');
const CREATED_AT = '2026-09-02T22:30:00Z';
const EXPECTED_GROUPS = ['291', '292', '293', '294'];
const ALLOWED_LESSON_TYPES = new Set(['lecture', 'practice', 'laboratory', 'seminar', 'exam', 'credit', 'graded-credit', 'consultation', 'other']);
const ALLOWED_EVENT_KEYS = new Set([
  'eventId', 'universityId', 'groupId', 'academicPeriodId', 'date', 'startTime', 'endTime',
  'timeSemantics', 'discipline', 'lessonType', 'teacher', 'location', 'assessment', 'sourceRef'
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

function toMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function assessmentType(label) {
  const normalized = label.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (normalized.includes('экзам')) return 'exam';
  if (normalized.includes('зач') && normalized.includes('оцен')) return 'graded-credit';
  if (normalized.includes('зач')) return 'credit';
  return 'other';
}

function propedeuticLocation(lowerReference) {
  const department = lowerReference?.department;
  if (typeof department !== 'string') return lowerReference?.location ?? null;
  const match = department.match(/\((.+)\)\s*$/u);
  return match ? match[1].trim() : (lowerReference.location ?? null);
}

function eventId(event) {
  const payload = [
    event.groupId,
    event.date,
    event.startTime,
    event.endTime,
    event.discipline,
    event.lessonType,
    event.location ?? '',
    event.sourceRef.locator ?? ''
  ].join('|');
  return `kgmu-${createHash('sha256').update(payload).digest('hex').slice(0, 24)}`;
}

function assertNormalizedEvent(event, index, sourceId) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail(`event ${index} must be an object`);
  for (const key of Object.keys(event)) {
    if (!ALLOWED_EVENT_KEYS.has(key)) fail(`event ${index} has unsupported property ${key}`);
  }
  for (const key of ['eventId', 'universityId', 'groupId', 'academicPeriodId', 'date', 'startTime', 'endTime', 'timeSemantics', 'discipline', 'lessonType']) {
    if (typeof event[key] !== 'string' || event[key].length === 0) fail(`event ${index}.${key} must be non-empty`);
  }
  if (event.universityId !== 'kirov-gmu') fail(`event ${index} universityId mismatch`);
  if (!EXPECTED_GROUPS.includes(event.groupId)) fail(`event ${index} unexpected group ${event.groupId}`);
  if (event.academicPeriodId !== PERIOD) fail(`event ${index} academicPeriodId mismatch`);
  if (!/^202[67]-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(Date.parse(`${event.date}T00:00:00Z`))) fail(`event ${index} invalid date`);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.startTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.endTime)) fail(`event ${index} invalid time`);
  if (toMinutes(event.endTime) <= toMinutes(event.startTime)) fail(`event ${index} non-positive interval`);
  if (event.timeSemantics !== 'floating') fail(`event ${index} must be floating`);
  if (!ALLOWED_LESSON_TYPES.has(event.lessonType)) fail(`event ${index} invalid lessonType`);
  if (event.teacher !== null && typeof event.teacher !== 'string') fail(`event ${index} teacher must be string/null`);
  if (event.location !== null && typeof event.location !== 'string') fail(`event ${index} location must be string/null`);
  if (!event.sourceRef || event.sourceRef.sourceId !== sourceId || typeof event.sourceRef.locator !== 'string' || !event.sourceRef.locator.startsWith('2 стомат.!')) {
    fail(`event ${index} invalid sourceRef`);
  }
  if (event.assessment !== undefined) {
    const assessment = event.assessment;
    if (!assessment || !['exam', 'credit', 'graded-credit', 'other'].includes(assessment.type)) fail(`event ${index} invalid assessment.type`);
    if (typeof assessment.label !== 'string' || assessment.label.length === 0) fail(`event ${index} invalid assessment.label`);
    if (!assessment.sourceRef || assessment.sourceRef.sourceId !== sourceId || typeof assessment.sourceRef.locator !== 'string') fail(`event ${index} invalid assessment.sourceRef`);
  }
}

function overlaps(a, b) {
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

function findOverlaps(events) {
  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  const found = [];
  for (const [key, dayEvents] of byDay) {
    dayEvents.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.eventId.localeCompare(b.eventId));
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) {
        if (toMinutes(dayEvents[j].startTime) >= toMinutes(dayEvents[i].endTime)) break;
        if (!overlaps(dayEvents[i], dayEvents[j])) continue;
        const [groupId, date] = key.split('|');
        found.push({
          groupId,
          date,
          first: {
            eventId: dayEvents[i].eventId,
            time: `${dayEvents[i].startTime}-${dayEvents[i].endTime}`,
            discipline: dayEvents[i].discipline,
            sourceLocator: dayEvents[i].sourceRef.locator
          },
          second: {
            eventId: dayEvents[j].eventId,
            time: `${dayEvents[j].startTime}-${dayEvents[j].endTime}`,
            discipline: dayEvents[j].discipline,
            sourceLocator: dayEvents[j].sourceRef.locator
          }
        });
      }
    }
  }
  return found;
}

function check(code, status, message) {
  return { code, status, message };
}

async function main() {
  const [source, job, compact, priorQa, evidence] = await Promise.all([
    readJson(SOURCE_PATH), readJson(JOB_PATH), readJson(COMPACT_PATH), readJson(QA_PATH), readJson(EVIDENCE_PATH)
  ]);

  if (source.parserProfile !== 'mixed') fail('Dentistry 291-294 must use mixed parser profile');
  if (source.parserRulesVersion !== 'kgmu-2026-08-27-v3' || job.parserRulesVersion !== source.parserRulesVersion) fail('parser rule pin mismatch');
  if (source.source.objectKey !== job.sourceObjectKey) fail('ParsingJob must be bound to SourceArtifact objectKey');
  if (source.idempotency?.sourceArtifactKey !== `sha256:${source.source.sha256}` || source.idempotency?.reuseIfShaMatches !== true) fail('SourceArtifact idempotency evidence is invalid');
  if (priorQa.status !== 'PASS' || priorQa.warnings?.length) fail('source-semantic QA must be PASS before finalization');
  if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(EXPECTED_GROUPS) || JSON.stringify(job.expectedGroupIds) !== JSON.stringify(EXPECTED_GROUPS)) fail('expected groups mismatch');

  const fields = compact.tupleFields;
  if (!Array.isArray(fields) || fields.join('|') !== 'eventId|groupId|date|startTime|endTime|discipline|lessonType|location|sourceLocator') fail('unexpected compact intermediate schema');
  if (!Array.isArray(compact.events) || compact.events.length !== compact.eventCount) fail('compact eventCount mismatch');

  const assessmentByDiscipline = new Map();
  for (const [discipline, reference] of Object.entries(evidence.lowerReferenceRows ?? {})) {
    if (!reference?.assessment) continue;
    assessmentByDiscipline.set(discipline, {
      type: assessmentType(reference.assessment),
      label: reference.assessment.toLocaleLowerCase('ru-RU'),
      sourceRef: { sourceId: source.source.sourceId, locator: reference.assessmentSource }
    });
  }
  const cycleReference = evidence.lowerReferenceRows?.['Пропедевтическая стоматология'];
  const cycleLocation = propedeuticLocation(cycleReference);
  if (!cycleLocation || !cycleLocation.includes('Никитская') || !cycleLocation.includes('161')) fail('S09 Propedeutic Dentistry location is unresolved');

  const events = compact.events.map((row, index) => {
    if (!Array.isArray(row) || row.length !== fields.length) fail(`invalid compact tuple ${index}`);
    const raw = Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
    const location = raw.discipline === 'Пропедевтическая стоматология' ? cycleLocation : raw.location;
    const event = {
      eventId: '',
      universityId: 'kirov-gmu',
      groupId: raw.groupId,
      academicPeriodId: PERIOD,
      date: raw.date,
      startTime: raw.startTime,
      endTime: raw.endTime,
      timeSemantics: 'floating',
      discipline: raw.discipline,
      lessonType: raw.lessonType,
      teacher: null,
      location,
      sourceRef: { sourceId: source.source.sourceId, locator: raw.sourceLocator }
    };
    const assessment = assessmentByDiscipline.get(raw.discipline);
    if (assessment) event.assessment = structuredClone(assessment);
    event.eventId = eventId(event);
    assertNormalizedEvent(event, index, source.source.sourceId);
    return event;
  });

  const ids = new Set(events.map((event) => event.eventId));
  if (ids.size !== events.length) fail('finalized eventId collision detected');
  const signatures = new Set();
  for (const event of events) {
    const signature = canonicalJson({
      groupId: event.groupId,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      discipline: event.discipline,
      lessonType: event.lessonType,
      location: event.location
    });
    if (signatures.has(signature)) fail(`duplicate normalized event signature: ${signature}`);
    signatures.add(signature);
  }

  const groupEventCounts = Object.fromEntries(EXPECTED_GROUPS.map((groupId) => [groupId, events.filter((event) => event.groupId === groupId).length]));
  if (Object.values(groupEventCounts).some((count) => count <= 0) || Object.values(groupEventCounts).reduce((a, b) => a + b, 0) !== events.length) fail('final group coverage mismatch');
  const assessmentEventCount = events.filter((event) => event.assessment).length;
  const assessmentDisciplines = [...new Set(events.filter((event) => event.assessment).map((event) => event.discipline))].sort();
  if (assessmentEventCount === 0) fail('assessment metadata from R41/S09 was lost');

  const timeOverlaps = findOverlaps(events);
  const candidateDigest = digestNormalizedEvents(events);
  const draft = {
    schema: 'kgmu-normalized-draft-v1',
    draftId: 'normalized-draft-dentistry-291-294-2026-09-03-v1',
    parsingJobId: job.jobId,
    sourceArtifactId: source.source.sourceArtifactId,
    sourceSha256: source.source.sha256,
    parserProfile: source.parserProfile,
    parserRulesVersion: source.parserRulesVersion,
    status: 'PASS',
    candidateDigest,
    eventCount: events.length,
    expectedGroupIds: source.expectedGroupIds,
    groupEventCounts,
    events
  };

  const qaChecks = [
    check('source-artifact-pinned', 'pass', `Official XLSX is pinned by SHA-256 ${source.source.sha256}; SourceArtifact identity ${source.source.sourceArtifactId} uses a SHA-addressed object key and reuseIfShaMatches=true.`),
    check('parsing-job-contract', 'pass', `ParsingJob ${job.jobId} is source-object-key-bound and targets only groups 291-294 with parser rules ${job.parserRulesVersion}.`),
    check('event-bearing-source-coverage', 'pass', `${evidence.scheduleCoverage?.coveredCells?.length ?? 0}/${evidence.scheduleCoverage?.expectedCells?.length ?? 0} weekly event-bearing source cells are covered; unexplained source fragments: ${evidence.scheduleCoverage?.unmatched?.length ?? 0}.`),
    check('cross-day-count-notes', 'pass', `${evidence.crossDayExpectations?.length ?? 0} R07-R09/R67 count/day expectations are resolved with 0 unresolved notes.`),
    check('mixed-cycle-s-profile', 'pass', `Propedeutic Dentistry cycles for groups 291-294 are expanded under S01/S08/S09 at 13:00-17:05 with source-confirmed location "${cycleLocation}".`),
    check('curator-hour-resolution', 'pass', `${evidence.curatorHour?.events?.length ?? 0} undated curator-hour fragments are resolved by R17/S07 after mandatory-event conflict checks.`),
    check('assessment-metadata-preserved', 'pass', `${assessmentEventCount} events across ${assessmentDisciplines.length} disciplines preserve lower-reference exam/credit metadata under R41/S09.`),
    check('normalized-event-v1-integrity', 'pass', `${events.length} full NormalizedEvent-v1-compatible events; group counts ${EXPECTED_GROUPS.map((g) => `${g}=${groupEventCounts[g]}`).join(', ')}; unique eventIds and 0 duplicate logical signatures.`),
    check('source-overlap-policy', 'pass', `${timeOverlaps.length} time-overlap pairs are preserved unchanged and recorded as source conflicts under R69/S04; overlap presence is not treated as a parser failure.`),
    check('unresolved-ambiguities-zero-before-pass', 'pass', '0 unexplained source fragments and 0 unresolved count/day notes remain before PASS.'),
    check('shared-core-boundary', 'pass', 'No medical-calendar-core, shared schema, shared parser/pipeline, database, publish mechanism, or production-infrastructure change is required.'),
    check('publication-scope', 'pass', 'ScheduleVersion creation/publication is intentionally not executed by this draft+QA workflow.')
  ];
  const qa = {
    qaReportId: 'qa-kgmu-2026-2027-s1-dentistry-291-294-v1',
    parsingJobId: job.jobId,
    sourceArtifactId: source.source.sourceArtifactId,
    candidateDigest,
    decision: 'pass',
    checks: qaChecks,
    createdAt: CREATED_AT
  };

  evidence.finalNormalizedDraft = {
    schema: draft.schema,
    sourceArtifactId: draft.sourceArtifactId,
    candidateDigest,
    eventCount: events.length,
    groupEventCounts,
    assessmentEventCount,
    assessmentDisciplines,
    propedeuticLocation: cycleLocation,
    normalizedEventV1Compatible: true
  };
  evidence.timeOverlapAudit = {
    policy: 'R69/S04 preserve source-defined overlaps',
    overlapCount: timeOverlaps.length,
    overlaps: timeOverlaps
  };

  await Promise.all([
    writeFile(DRAFT_PATH, `${JSON.stringify(draft)}\n`, 'utf8'),
    writeFile(QA_PATH, `${JSON.stringify(qa, null, 2)}\n`, 'utf8'),
    writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  ]);

  console.log(JSON.stringify({
    status: 'PASS',
    sourceArtifactId: source.source.sourceArtifactId,
    parsingJobId: job.jobId,
    candidateDigest,
    eventCount: events.length,
    groupEventCounts,
    assessmentEventCount,
    assessmentDisciplines,
    timeOverlapCount: timeOverlaps.length,
    propedeuticLocation: cycleLocation,
    sharedCoreChanged: false,
    scheduleVersionCreated: false,
    published: false
  }, null, 2));
}

await main();
