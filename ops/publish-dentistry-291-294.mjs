#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalJson, digestNormalizedEvents, sha256Hex } from '../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

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

async function loadPlan() {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-291-294.source.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'dentistry' || source.course !== 2) throw new Error('unexpected Dentistry course-2 source identity');
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') throw new Error('unexpected academic period');
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (draft.sourceSha256 !== sourceSha256 || publication.sourceSha256 !== sourceSha256) throw new Error('Dentistry course-2 source SHA-256 evidence mismatch');
  if (draft.parserRulesVersion !== source.parserRulesVersion) throw new Error('Dentistry course-2 parser evidence mismatch');
  if (draft.status !== 'PASS') throw new Error(`normalized draft status must be PASS, got ${draft.status}`);
  if (qa.decision !== 'pass') throw new Error('Dentistry course-2 QA is not ScheduleVersion-ready');
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) throw new Error('QA decision must be pass with no failing checks before publication');
  if (!Array.isArray(draft.events)) throw new Error('normalized draft events must be an array');

  const events = draft.events;
  const candidateDigest = assertNonEmptyString(draft.candidateDigest, 'draft.candidateDigest');
  if (candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) throw new Error(`Dentistry course-2 approved artifact digest mismatch: ${candidateDigest}`);
  const normalizedEventSetDigest = digestNormalizedEvents(events);
  if (normalizedEventSetDigest !== publication.eventSetDigest) throw new Error(`Dentistry course-2 event-set digest mismatch: ${normalizedEventSetDigest}`);
  if (events.length !== 1066 || events.length !== draft.eventCount || events.length !== publication.eventCount) throw new Error(`Dentistry course-2 event count mismatch: ${events.length}`);
  if (events.some((event) => event.timeSemantics !== 'floating')) throw new Error('Dentistry course-2 publication candidate must contain floating events only');
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('Dentistry course-2 duplicate eventId detected');

  const expectedGroups = source.expectedGroupIds;
  if (JSON.stringify(expectedGroups) !== JSON.stringify(['291', '292', '293', '294'])) throw new Error('unexpected Dentistry course-2 group scope');
  const actualCounts = countByGroup(events);
  const facultativeIds = new Set(publication.facultativeIds);
  if (facultativeIds.size !== publication.facultativeIds.length) throw new Error('duplicate facultativeId in publication evidence');
  const actualFacultativeIds = new Set(events.filter((event) => event.facultativeId != null).map((event) => event.facultativeId));
  if (JSON.stringify([...actualFacultativeIds].sort()) !== JSON.stringify([...facultativeIds].sort())) throw new Error('Dentistry course-2 facultative catalog does not match publication evidence');
  if (facultativeIds.size !== 0) throw new Error('Dentistry course-2 publication evidence must not contain facultative IDs');

  for (const groupId of expectedGroups) {
    if (actualCounts[groupId] !== publication.groupEventCounts?.[groupId] || actualCounts[groupId] !== draft.groupEventCounts?.[groupId]) throw new Error(`group ${groupId} event count evidence mismatch`);
    const groupEvents = events.filter((event) => event.groupId === groupId);
    const facultativeCount = groupEvents.filter((event) => event.facultativeId != null).length;
    const defaultVisibleCount = groupEvents.length - facultativeCount;
    if (facultativeCount !== publication.groupFacultativeEventCounts?.[groupId]) throw new Error(`group ${groupId} facultative event count evidence mismatch`);
    if (defaultVisibleCount !== publication.groupDefaultVisibleEventCounts?.[groupId]) throw new Error(`group ${groupId} default-visible event count evidence mismatch`);
  }
  if (Object.keys(actualCounts).length !== expectedGroups.length) throw new Error('candidate contains unexpected groups');

  const versions = expectedGroups.map((groupId) => ({
    groupId,
    versionId: stableVersionId({ academicPeriodId: source.academicPeriodId, programId: source.programId, groupId, candidateDigest }),
    eventCount: actualCounts[groupId]
  }));

  return {
    plan: {
      universityId: source.universityId,
      programId: source.programId,
      academicYearId: source.academicYear,
      academicPeriodId: source.academicPeriodId,
      sourceId: source.source.sourceId,
      sourceSha256,
      candidateDigest,
      eventSetDigest: normalizedEventSetDigest,
      coreEvidence: publication.sharedContractEvidence,
      events,
      versions,
      publication,
      parsingResult: { jobId: qa.parsingJobId, universityId: source.universityId, academicPeriodId: source.academicPeriodId, events }
    },
    qaForPublication: {
      qaReportId: qa.qaReportId,
      parsingJobId: qa.parsingJobId,
      candidateDigest,
      decision: 'pass',
      checks: qa.checks,
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
  eventCount: plan.events.length,
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
  const repository = core.createSqliteScheduleRepository(database);

  for (const version of plan.versions) {
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const current = await repository.getPublishedSchedule({ universityId: plan.universityId, groupId: version.groupId, academicYearId: plan.academicYearId, academicPeriodId: plan.academicPeriodId });
    if (current) {
      if (current.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}`);
      if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) throw new Error(`group ${version.groupId} published target does not match the approved candidate`);
      console.log(`group ${version.groupId}: already published and verified; skipping`);
      continue;
    }

    const targetRow = database.prepare('SELECT version_id, status FROM schedule_versions WHERE version_id = ?').get(version.versionId);
    if (targetRow && targetRow.status !== 'ready') throw new Error(`group ${version.groupId} target version has unexpected status ${targetRow.status}`);
    if (targetRow) {
      const storedRows = database.prepare('SELECT event_json FROM schedule_events WHERE version_id = ? ORDER BY event_id').all(version.versionId);
      const storedEvents = storedRows.map((row) => JSON.parse(row.event_json));
      if (storedEvents.length !== version.eventCount || eventSetDigest(storedEvents) !== expectedDigest) throw new Error(`group ${version.groupId} ready target does not match the approved candidate`);
      console.log(`group ${version.groupId}: resuming existing verified ready version`);
    } else {
      const snapshot = core.createReadyScheduleVersion({ parsingResult: plan.parsingResult, qaReport: qaForPublication, candidateDigest: plan.candidateDigest, groupId: version.groupId, versionId: version.versionId });
      await repository.saveReadySnapshot({ academicYearId: plan.academicYearId, scheduleVersion: snapshot.scheduleVersion, events: snapshot.events });
      console.log(`group ${version.groupId}: saved ready version ${version.versionId}`);
    }
    await repository.publishVersion({ versionId: version.versionId });
    console.log(`group ${version.groupId}: published ${version.versionId}`);
  }

  for (const version of plan.versions) {
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({ universityId: plan.universityId, groupId: version.groupId, academicYearId: plan.academicYearId, academicPeriodId: plan.academicPeriodId });
    if (!published || published.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} final published version verification failed`);
    if (published.events.length !== version.eventCount || eventSetDigest(published.events) !== expectedDigest) throw new Error(`group ${version.groupId} final event-set verification failed`);

    const publishedCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM schedule_versions WHERE university_id = ? AND group_id = ? AND academic_year_id = ? AND academic_period_id = ? AND status = 'published'`).get(plan.universityId, version.groupId, plan.academicYearId, plan.academicPeriodId)?.count ?? 0);
    if (publishedCount !== 1) throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);

    const defaultIcs = unfoldIcs(core.renderPublishedScheduleIcs({ scheduleVersion: published.scheduleVersion, events: published.events, calendarName: `КГМУ стоматология ${version.groupId}` }));
    const expectedDefaultCount = plan.publication.groupDefaultVisibleEventCounts[version.groupId];
    if (countVevents(defaultIcs) !== expectedDefaultCount) throw new Error(`group ${version.groupId} default ICS count verification failed`);

    const allFacultativeChoices = Object.fromEntries(plan.publication.facultativeIds.map((facultativeId) => [facultativeId, true]));
    const allChoicesIcs = unfoldIcs(core.renderPublishedScheduleIcs({ scheduleVersion: published.scheduleVersion, events: published.events, calendarName: `КГМУ стоматология ${version.groupId}`, preferences: { facultativeChoices: allFacultativeChoices } }));
    if (countVevents(allChoicesIcs) !== version.eventCount) throw new Error(`group ${version.groupId} full ICS VEVENT count verification failed`);
    if (published.events.some((event) => event.assessment) && !allChoicesIcs.includes('DESCRIPTION:')) throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  console.log(JSON.stringify({ result: 'PRODUCTION_DENTISTRY_COURSE_2_SCHEDULES_PUBLISHED_AND_VERIFIED', coreBoundary: boundary, groupCount: plan.versions.length, eventCount: plan.events.length, oldScheduleVersionRowsPreserved: true, trialChanged: false, checkoutChanged: false, subscriptionTokensChanged: false, calendarPreferencesChanged: false }, null, 2));
} finally {
  database.close();
}
