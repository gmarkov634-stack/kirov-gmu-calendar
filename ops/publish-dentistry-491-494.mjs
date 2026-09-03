#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { toCorePersistenceEvents } from '../src/core-persistence-events.js';
import { canonicalJson, digestNormalizedEvents, sha256Hex } from '../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

const UNIVERSITY_ID = 'kirov-gmu';
const PROGRAM_ID = 'dentistry';
const ACADEMIC_YEAR_ID = '2026-2027';
const ACADEMIC_PERIOD_ID = '2026-2027-semester-1';
const GROUPS = ['491', '492', '493', '494'];
const SOURCE_SHA256 = '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265';
const CANDIDATE_DIGEST = 'sha256:2a0490e90c89cfb40004b128c8429f896108ff9fc98e98cd1426adae171931a1';
const EXPECTED_COUNTS = Object.freeze({ '491': 133, '492': 133, '493': 133, '494': 132 });
const EXPECTED_DATE_ONLY_COUNTS = Object.freeze({ '491': 12, '492': 12, '493': 12, '494': 12 });

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function eventSetDigest(events) {
  const sorted = [...events].sort((a, b) => a.eventId.localeCompare(b.eventId));
  return sha256Hex(canonicalJson(sorted));
}

function unfoldIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

function countVevents(ics) {
  return (ics.match(/BEGIN:VEVENT/g) ?? []).length;
}

function countByGroup(events) {
  const counts = {};
  for (const event of events) counts[event.groupId] = (counts[event.groupId] ?? 0) + 1;
  return counts;
}

function stableVersionId({ academicPeriodId, programId, groupId, candidateDigest }) {
  const match = academicPeriodId.match(/^\d{4}-\d{4}-semester-(\d+)$/);
  if (!match) throw new Error(`unsupported academicPeriodId for stable version id: ${academicPeriodId}`);
  const digest = assertNonEmptyString(candidateDigest, 'candidateDigest').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new TypeError('candidateDigest must be a SHA-256 digest');
  return `kgmu-2026-2027-s${match[1]}-${programId}-${groupId}-${digest.slice(0, 16)}`;
}

function coreQaChecks(qa) {
  return qa.checks.map((check) => ({
    code: assertNonEmptyString(check.name, 'qa.check.name'),
    status: check.status === 'PASS' ? 'pass' : check.status === 'WARNING' ? 'warning' : 'fail',
    message: check.detail == null ? null : typeof check.detail === 'string' ? check.detail : JSON.stringify(check.detail)
  }));
}

async function loadPlan() {
  const [sourceArtifact, parsingJob, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.source-artifact.json'),
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.parsing-job.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.publication-evidence.json')
  ]);

  if (sourceArtifact.universityId !== UNIVERSITY_ID || sourceArtifact.sourceId !== PROGRAM_ID) throw new Error('unexpected Dentistry course-4 source identity');
  if (sourceArtifact.academicPeriodId !== ACADEMIC_PERIOD_ID) throw new Error('unexpected academic period');
  if (sourceArtifact.sha256 !== SOURCE_SHA256 || parsingJob.sourceSha256 !== SOURCE_SHA256 || draft.sourceSha256 !== SOURCE_SHA256 || qa.sourceSha256 !== SOURCE_SHA256 || publication.sourceSha256 !== SOURCE_SHA256) throw new Error('Dentistry course-4 source SHA-256 evidence mismatch');
  if (draft.parserRulesVersion !== parsingJob.parserRulesVersion) throw new Error('Dentistry course-4 parser evidence mismatch');
  if (draft.status !== 'PASS' || qa.status !== 'PASS' || qa.publishEligible !== true || qa.scheduleVersionReady !== true) throw new Error('Dentistry course-4 QA is not ScheduleVersion-ready');
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status !== 'PASS')) throw new Error('QA must contain only PASS checks before publication');
  if (!Array.isArray(qa.blockers) || qa.blockers.length !== 0) throw new Error('QA blockers must be empty before publication');
  if (!Array.isArray(draft.events)) throw new Error('normalized draft events must be an array');

  const events = draft.events;
  const candidateDigest = assertNonEmptyString(draft.candidateDigest, 'draft.candidateDigest');
  if (candidateDigest !== CANDIDATE_DIGEST || candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) throw new Error(`Dentistry course-4 approved artifact digest mismatch: ${candidateDigest}`);
  const normalizedEventSetDigest = digestNormalizedEvents(events);
  if (normalizedEventSetDigest !== publication.eventSetDigest || normalizedEventSetDigest !== CANDIDATE_DIGEST) throw new Error(`Dentistry course-4 event-set digest mismatch: ${normalizedEventSetDigest}`);
  if (events.length !== 531 || events.length !== draft.eventCount || events.length !== publication.eventCount) throw new Error(`Dentistry course-4 event count mismatch: ${events.length}`);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('Dentistry course-4 duplicate eventId detected');
  if (events.some((event) => !['floating', 'date-only'].includes(event.timeSemantics))) throw new Error('Dentistry course-4 contains unsupported time semantics');
  if (events.filter((event) => event.timeSemantics === 'date-only').length !== 48) throw new Error('Dentistry course-4 must contain exactly 48 date-only Practice events');

  const persistenceEvents = toCorePersistenceEvents(events);
  if (persistenceEvents.length !== events.length) throw new Error('Dentistry course-4 persistence adaptation changed event count');
  if (persistenceEvents.some((event, index) => event.eventId !== events[index].eventId || event.groupId !== events[index].groupId || event.timeSemantics !== events[index].timeSemantics)) throw new Error('Dentistry course-4 persistence adaptation changed event identity');
  const persistenceDateOnlyEvents = persistenceEvents.filter((event) => event.timeSemantics === 'date-only');
  if (persistenceDateOnlyEvents.length !== 48) throw new Error('Dentistry course-4 persistence adaptation changed date-only count');
  if (persistenceDateOnlyEvents.some((event) => Object.hasOwn(event, 'startTime') || Object.hasOwn(event, 'endTime'))) throw new Error('Dentistry course-4 persistence date-only events must omit startTime and endTime');
  const persistenceEventSetDigest = eventSetDigest(persistenceEvents);

  if (JSON.stringify(sourceArtifact.expectedGroupIds) !== JSON.stringify(GROUPS) || JSON.stringify(parsingJob.expectedGroupIds) !== JSON.stringify(GROUPS)) throw new Error('unexpected Dentistry course-4 group scope');
  const actualCounts = countByGroup(events);
  for (const groupId of GROUPS) {
    if (actualCounts[groupId] !== EXPECTED_COUNTS[groupId] || actualCounts[groupId] !== publication.groupEventCounts?.[groupId]) throw new Error(`group ${groupId} event count evidence mismatch`);
    const groupEvents = events.filter((event) => event.groupId === groupId);
    const dateOnlyCount = groupEvents.filter((event) => event.timeSemantics === 'date-only').length;
    if (dateOnlyCount !== EXPECTED_DATE_ONLY_COUNTS[groupId] || dateOnlyCount !== publication.groupDateOnlyEventCounts?.[groupId]) throw new Error(`group ${groupId} date-only event count evidence mismatch`);
    if (publication.groupDefaultVisibleEventCounts?.[groupId] !== EXPECTED_COUNTS[groupId]) throw new Error(`group ${groupId} default-visible count evidence mismatch`);
    if (publication.groupFacultativeEventCounts?.[groupId] !== 0) throw new Error(`group ${groupId} facultative count must be zero`);
  }
  if (Object.keys(actualCounts).length !== GROUPS.length) throw new Error('candidate contains unexpected groups');
  if (!Array.isArray(publication.facultativeIds) || publication.facultativeIds.length !== 0) throw new Error('Dentistry course-4 publication evidence must not contain facultative IDs');

  const versions = GROUPS.map((groupId) => ({
    groupId,
    versionId: stableVersionId({ academicPeriodId: ACADEMIC_PERIOD_ID, programId: PROGRAM_ID, groupId, candidateDigest }),
    eventCount: actualCounts[groupId]
  }));

  return {
    plan: {
      universityId: UNIVERSITY_ID,
      programId: PROGRAM_ID,
      academicYearId: ACADEMIC_YEAR_ID,
      academicPeriodId: ACADEMIC_PERIOD_ID,
      sourceId: sourceArtifact.sourceId,
      sourceSha256: SOURCE_SHA256,
      candidateDigest,
      eventSetDigest: normalizedEventSetDigest,
      persistenceEventSetDigest,
      coreEvidence: publication.sharedContractEvidence,
      events,
      persistenceEvents,
      versions,
      publication,
      parsingResult: {
        jobId: parsingJob.jobId,
        universityId: UNIVERSITY_ID,
        academicPeriodId: ACADEMIC_PERIOD_ID,
        events: persistenceEvents
      }
    },
    qaForPublication: {
      qaReportId: `qa-dentistry-491-494-${SOURCE_SHA256.slice(0, 16)}-v1`,
      parsingJobId: parsingJob.jobId,
      candidateDigest,
      decision: 'pass',
      checks: coreQaChecks(qa),
      createdAt: publication.createdAt
    }
  };
}

async function verifyCoreBoundary(coreRoot, coreEvidence) {
  const deployedCommit = (await readFile(resolve(coreRoot, '.deployed-commit'), 'utf8')).trim();
  if (!/^[0-9a-f]{40}$/.test(deployedCommit)) throw new Error(`deployed core commit marker is invalid: ${deployedCommit}`);
  if (deployedCommit !== coreEvidence.productionRuntimeCommit) throw new Error(`deployed core commit mismatch: ${deployedCommit}`);
  const [schema, renderer] = await Promise.all([
    readFile(resolve(coreRoot, 'contracts/normalized-event.schema.json')),
    readFile(resolve(coreRoot, 'src/calendar/ics-renderer.js'))
  ]);
  const schemaBlob = gitBlobSha(schema);
  const rendererBlob = gitBlobSha(renderer);
  if (schemaBlob !== coreEvidence.normalizedEventSchemaBlob) throw new Error(`deployed core NormalizedEvent schema blob mismatch: ${schemaBlob}`);
  if (rendererBlob !== coreEvidence.icsRendererBlob) throw new Error(`deployed core ICS renderer blob mismatch: ${rendererBlob}`);
  return { commit: deployedCommit, schemaBlob, rendererBlob };
}

const { plan, qaForPublication } = await loadPlan();
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'preflight',
  universityId: plan.universityId,
  programId: plan.programId,
  academicYearId: plan.academicYearId,
  academicPeriodId: plan.academicPeriodId,
  sourceSha256: plan.sourceSha256,
  candidateDigest: plan.candidateDigest,
  eventSetDigest: plan.eventSetDigest,
  persistenceEventSetDigest: plan.persistenceEventSetDigest,
  eventCount: plan.events.length,
  dateOnlyEventCount: plan.events.filter((event) => event.timeSemantics === 'date-only').length,
  persistenceDateOnlyTimingFieldsOmitted: plan.persistenceEvents.filter((event) => event.timeSemantics === 'date-only').every((event) => !Object.hasOwn(event, 'startTime') && !Object.hasOwn(event, 'endTime')),
  facultativeIds: plan.publication.facultativeIds,
  versions: plan.versions
}, null, 2));

if (!APPLY) {
  console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
  process.exit(0);
}

const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
if (typeof databasePath !== 'string' || databasePath.length === 0) throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');

const boundary = await verifyCoreBoundary(coreRoot, plan.coreEvidence);
const core = await import(pathToFileURL(resolve(coreRoot, 'src/index.js')).href);
for (const name of ['openSqliteRuntimeDatabase', 'createSqliteScheduleRepository', 'createReadyScheduleVersion', 'renderPublishedScheduleIcs']) {
  if (typeof core[name] !== 'function') throw new Error(`deployed core is missing ${name}`);
}

const database = core.openSqliteRuntimeDatabase({ path: databasePath });
try {
  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);
  const fkBefore = database.prepare('PRAGMA foreign_key_check').all();
  if (fkBefore.length !== 0) throw new Error(`SQLite foreign_key_check failed before publication: ${fkBefore.length}`);
  const repository = core.createSqliteScheduleRepository(database);

  for (const version of plan.versions) {
    const expectedEvents = plan.persistenceEvents.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const current = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (current) {
      if (current.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}`);
      if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) throw new Error(`group ${version.groupId} published target does not match the approved candidate persistence form`);
      console.log(`group ${version.groupId}: already published and verified; skipping`);
      continue;
    }

    const targetRow = database.prepare('SELECT version_id, status FROM schedule_versions WHERE version_id = ?').get(version.versionId);
    if (targetRow && targetRow.status !== 'ready') throw new Error(`group ${version.groupId} target version has unexpected status ${targetRow.status}`);
    if (targetRow) {
      const storedRows = database.prepare('SELECT event_json FROM schedule_events WHERE version_id = ? ORDER BY event_id').all(version.versionId);
      const storedEvents = storedRows.map((row) => JSON.parse(row.event_json));
      if (storedEvents.length !== version.eventCount || eventSetDigest(storedEvents) !== expectedDigest) throw new Error(`group ${version.groupId} ready target does not match the approved candidate persistence form`);
      console.log(`group ${version.groupId}: resuming existing verified ready version`);
    } else {
      const snapshot = core.createReadyScheduleVersion({
        parsingResult: plan.parsingResult,
        qaReport: qaForPublication,
        candidateDigest: plan.candidateDigest,
        groupId: version.groupId,
        versionId: version.versionId
      });
      await repository.saveReadySnapshot({
        academicYearId: plan.academicYearId,
        scheduleVersion: snapshot.scheduleVersion,
        events: snapshot.events
      });
      console.log(`group ${version.groupId}: saved ready version ${version.versionId}`);
    }
    await repository.publishVersion({ versionId: version.versionId });
    console.log(`group ${version.groupId}: published ${version.versionId}`);
  }

  for (const version of plan.versions) {
    const expectedEvents = plan.persistenceEvents.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} final published version verification failed`);
    if (published.events.length !== version.eventCount || eventSetDigest(published.events) !== expectedDigest) throw new Error(`group ${version.groupId} final event-set verification failed`);

    const publishedCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM schedule_versions WHERE university_id = ? AND group_id = ? AND academic_year_id = ? AND academic_period_id = ? AND status = 'published'`).get(plan.universityId, version.groupId, plan.academicYearId, plan.academicPeriodId)?.count ?? 0);
    if (publishedCount !== 1) throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);

    const defaultIcs = unfoldIcs(core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ стоматология ${version.groupId}`
    }));
    if (countVevents(defaultIcs) !== version.eventCount) throw new Error(`group ${version.groupId} default ICS count verification failed`);
    const dateOnlyCount = (defaultIcs.match(/DTSTART;VALUE=DATE:\d{8}/g) ?? []).length;
    if (dateOnlyCount !== plan.publication.groupDateOnlyEventCounts[version.groupId]) throw new Error(`group ${version.groupId} all-day ICS count verification failed`);
    if (!defaultIcs.includes('DTSTART;VALUE=DATE:20270118')) throw new Error(`group ${version.groupId} Practice start date is missing from ICS`);
    if (published.events.some((event) => event.assessment) && !defaultIcs.includes('DESCRIPTION:')) throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  const fkAfter = database.prepare('PRAGMA foreign_key_check').all();
  if (fkAfter.length !== 0) throw new Error(`SQLite foreign_key_check failed after publication: ${fkAfter.length}`);
  console.log(JSON.stringify({
    result: 'PRODUCTION_DENTISTRY_COURSE_4_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    groupCount: plan.versions.length,
    eventCount: plan.events.length,
    dateOnlyEventCount: 48,
    oldScheduleVersionRowsPreserved: true,
    trialChanged: false,
    checkoutChanged: false,
    subscriptionTokensChanged: false,
    calendarPreferencesChanged: false
  }, null, 2));
} finally {
  database.close();
}
