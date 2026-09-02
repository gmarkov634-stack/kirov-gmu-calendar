#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  canonicalJson,
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
  sha256Hex
} from '../src/explicit-decisions.js';

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
  const [manifest, source, normalizationEvidence, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-431-436.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-431-436.normalization-evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-431-436.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-431-436.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'pediatrics' || source.course !== 4) {
    throw new Error('unexpected Pediatrics course-4 source identity');
  }
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') {
    throw new Error('unexpected academic period');
  }
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (manifest.sourceSha256 !== sourceSha256 || normalizationEvidence.sourceSha256 !== sourceSha256 || publication.sourceSha256 !== sourceSha256) {
    throw new Error('course-4 source SHA-256 evidence mismatch');
  }
  if (manifest.parserRulesVersion !== source.parserRulesVersion || normalizationEvidence.parserRulesVersion !== source.parserRulesVersion) {
    throw new Error('course-4 parserRulesVersion evidence mismatch');
  }
  if (qa.decision !== 'pass' || !Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) {
    throw new Error('QA decision must be pass with no failing checks before publication');
  }

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) {
    throw new Error(`course-4 candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== qa.candidate?.eventCount || events.length !== publication.eventCount) {
    throw new Error(`course-4 event count mismatch: ${events.length}`);
  }
  if (!Array.isArray(source.expectedGroupIds) || JSON.stringify(source.expectedGroupIds) !== JSON.stringify(manifest.groupTable)) {
    throw new Error('course-4 group table mismatch');
  }
  if (events.some((event) => event.timeSemantics !== 'floating')) {
    throw new Error('course-4 publication candidate must contain floating events only');
  }
  if (events.some((event) => event.facultativeId != null)) {
    throw new Error('course-4 candidate unexpectedly contains facultative events');
  }

  const actualCounts = countByGroup(events);
  for (const groupId of source.expectedGroupIds) {
    const expected = qa.candidate?.groupEventCounts?.[groupId];
    if (actualCounts[groupId] !== expected || publication.groupEventCounts?.[groupId] !== expected) {
      throw new Error(`group ${groupId} event count evidence mismatch`);
    }
  }
  if (Object.keys(actualCounts).length !== source.expectedGroupIds.length) throw new Error('candidate contains unexpected groups');

  const versions = source.expectedGroupIds.map((groupId) => ({
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
      coreEvidence: publication.sharedContractEvidence,
      events,
      versions,
      parsingResult: {
        jobId: qa.parsingJobId,
        universityId: source.universityId,
        academicPeriodId: source.academicPeriodId,
        events
      }
    },
    qaForPublication: {
      qaReportId: qa.qaReportId,
      parsingJobId: qa.parsingJobId,
      candidateDigest,
      decision: 'pass',
      checks: qa.checks,
      createdAt: qa.createdAt
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
  eventCount: plan.events.length,
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
    const current = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
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
      const snapshot = core.createReadyScheduleVersion({
        parsingResult: plan.parsingResult,
        qaReport: qaForPublication,
        candidateDigest: plan.candidateDigest,
        groupId: version.groupId,
        versionId: version.versionId
      });
      await repository.saveReadySnapshot({ academicYearId: plan.academicYearId, scheduleVersion: snapshot.scheduleVersion, events: snapshot.events });
      console.log(`group ${version.groupId}: saved ready version ${version.versionId}`);
    }
    await repository.publishVersion({ versionId: version.versionId });
    console.log(`group ${version.groupId}: published ${version.versionId}`);
  }

  for (const version of plan.versions) {
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} final published version verification failed`);
    if (published.events.length !== version.eventCount || eventSetDigest(published.events) !== expectedDigest) throw new Error(`group ${version.groupId} final event-set verification failed`);
    const publishedCount = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM schedule_versions
      WHERE university_id = ? AND group_id = ? AND academic_year_id = ? AND academic_period_id = ? AND status = 'published'
    `).get(plan.universityId, version.groupId, plan.academicYearId, plan.academicPeriodId)?.count ?? 0);
    if (publishedCount !== 1) throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);

    const ics = unfoldIcs(core.renderPublishedScheduleIcs({ scheduleVersion: published.scheduleVersion, events: published.events, calendarName: `КГМУ педиатрия ${version.groupId}` }));
    if (countVevents(ics) !== version.eventCount) throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
    if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  console.log(JSON.stringify({
    result: 'PRODUCTION_PEDIATRICS_COURSE_4_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    groupCount: plan.versions.length,
    eventCount: plan.events.length,
    oldScheduleVersionRowsPreserved: true
  }, null, 2));
} finally {
  database.close();
}
