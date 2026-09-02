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

const EXPECTED_DIGEST = 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f';
const GROUPS = ['631', '632', '633', '634', '635', '636', '637'];

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
  return sha256Hex(canonicalJson([...events].sort((a, b) => a.eventId.localeCompare(b.eventId))));
}

function countByGroup(events) {
  const counts = {};
  for (const event of events) counts[event.groupId] = (counts[event.groupId] ?? 0) + 1;
  return counts;
}

function stableVersionId({ academicPeriodId, programId, groupId, candidateDigest }) {
  const semester = academicPeriodId.match(/^\d{4}-\d{4}-semester-(\d+)$/)?.[1];
  if (!semester) throw new Error(`unsupported academicPeriodId: ${academicPeriodId}`);
  const digest = assertNonEmptyString(candidateDigest, 'candidateDigest').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new TypeError('candidateDigest must be a SHA-256 digest');
  return `kgmu-2026-2027-s${semester}-${programId}-${groupId}-${digest.slice(0, 16)}`;
}

function unfoldIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

function countMatches(value, regex) {
  return (value.match(regex) ?? []).length;
}

async function loadPlan() {
  const [source, decisions, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.source.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-631-637.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-631-637.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'pediatrics' || source.course !== 6) {
    throw new Error('unexpected Pediatrics course-6 source identity');
  }
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') {
    throw new Error('unexpected academic period');
  }
  if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(GROUPS)) throw new Error('course-6 group table mismatch');
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (sourceSha256 !== decisions.sourceSha256 || sourceSha256 !== publication.sourceSha256) {
    throw new Error('course-6 source SHA-256 evidence mismatch');
  }
  if (decisions.parserRulesVersion !== source.parserRulesVersion) throw new Error('course-6 parser rules evidence mismatch');
  if (qa.decision !== 'pass' || !Array.isArray(qa.checks) || qa.checks.some((check) => check?.status !== 'pass')) {
    throw new Error('QA decision must be pass with all checks passing before publication');
  }

  const events = expandExplicitDecisionManifest(decisions, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== EXPECTED_DIGEST || candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) {
    throw new Error(`course-6 candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== 679 || events.length !== publication.eventCount) throw new Error(`course-6 event count mismatch: ${events.length}`);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('course-6 duplicate eventId detected');

  const floating = events.filter((event) => event.timeSemantics === 'floating');
  const dateOnly = events.filter((event) => event.timeSemantics === 'date-only');
  if (floating.length !== 637 || dateOnly.length !== 42) throw new Error('course-6 timing-semantics cardinality mismatch');
  if (publication.timeSemanticsCounts?.floating !== 637 || publication.timeSemanticsCounts?.['date-only'] !== 42) {
    throw new Error('course-6 timing-semantics publication evidence mismatch');
  }
  if (dateOnly.some((event) => Object.hasOwn(event, 'startTime') || Object.hasOwn(event, 'endTime'))) {
    throw new Error('course-6 date-only candidate contains invented clock time');
  }
  if (dateOnly.some((event) => event.location != null)) throw new Error('course-6 date-only candidate contains invented location');

  const actualCounts = countByGroup(events);
  for (const groupId of GROUPS) {
    if (actualCounts[groupId] !== 97 || publication.groupEventCounts?.[groupId] !== 97) {
      throw new Error(`group ${groupId} event count evidence mismatch`);
    }
    const allDayCount = dateOnly.filter((event) => event.groupId === groupId).length;
    if (allDayCount !== 6 || publication.groupDateOnlyCounts?.[groupId] !== 6) {
      throw new Error(`group ${groupId} date-only count evidence mismatch`);
    }
  }
  if (Object.keys(actualCounts).length !== GROUPS.length) throw new Error('candidate contains unexpected groups');

  const versions = GROUPS.map((groupId) => ({
    groupId,
    versionId: stableVersionId({
      academicPeriodId: source.academicPeriodId,
      programId: source.programId,
      groupId,
      candidateDigest
    }),
    eventCount: 97,
    dateOnlyCount: 6
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

async function verifyCoreBoundary(coreRoot, evidence) {
  const deployedCommit = (await readFile(resolve(coreRoot, '.deployed-commit'), 'utf8')).trim();
  if (!/^[0-9a-f]{40}$/.test(deployedCommit)) throw new Error(`deployed core commit marker is invalid: ${deployedCommit}`);
  if (deployedCommit !== evidence.productionRuntimeCommit) throw new Error(`deployed core commit mismatch: ${deployedCommit}`);
  if (evidence.commit !== evidence.productionRuntimeCommit) throw new Error('course-6 core evidence commit/runtime mismatch');
  const [schema, renderer] = await Promise.all([
    readFile(resolve(coreRoot, 'contracts/normalized-event.schema.json')),
    readFile(resolve(coreRoot, 'src/calendar/ics-renderer.js'))
  ]);
  const schemaBlob = gitBlobSha(schema);
  const rendererBlob = gitBlobSha(renderer);
  if (schemaBlob !== evidence.normalizedEventSchemaBlob) throw new Error(`deployed core NormalizedEvent schema blob mismatch: ${schemaBlob}`);
  if (rendererBlob !== evidence.icsRendererBlob) throw new Error(`deployed core ICS renderer blob mismatch: ${rendererBlob}`);
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
  floatingEventCount: 637,
  dateOnlyEventCount: 42,
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
  if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('SQLite integrity_check failed');
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('SQLite foreign_key_check failed');
  const migration = database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='008_date_only_event_timing'").get()?.count;
  if (Number(migration) !== 1) throw new Error('date-only migration 008 is not active');
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
      if (current.scheduleVersion.versionId !== version.versionId) {
        throw new Error(`group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}`);
      }
      if (current.events.length !== 97 || eventSetDigest(current.events) !== expectedDigest) {
        throw new Error(`group ${version.groupId} published target does not match approved candidate`);
      }
      console.log(`group ${version.groupId}: already published and verified; skipping`);
      continue;
    }

    const targetRow = database.prepare('SELECT status FROM schedule_versions WHERE version_id=?').get(version.versionId);
    if (targetRow && targetRow.status !== 'ready') throw new Error(`group ${version.groupId} target version has unexpected status ${targetRow.status}`);
    if (targetRow) {
      const rows = database.prepare('SELECT event_json FROM schedule_events WHERE version_id=? ORDER BY event_id').all(version.versionId);
      const storedEvents = rows.map((row) => JSON.parse(row.event_json));
      if (storedEvents.length !== 97 || eventSetDigest(storedEvents) !== expectedDigest) {
        throw new Error(`group ${version.groupId} ready target does not match approved candidate`);
      }
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
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) throw new Error(`group ${version.groupId} final published version verification failed`);
    if (published.events.length !== 97 || eventSetDigest(published.events) !== expectedDigest) throw new Error(`group ${version.groupId} final event-set verification failed`);
    if (published.events.filter((event) => event.timeSemantics === 'date-only').length !== 6) throw new Error(`group ${version.groupId} final date-only count verification failed`);
    const publishedCount = Number(database.prepare("SELECT COUNT(*) AS count FROM schedule_versions WHERE university_id=? AND group_id=? AND academic_year_id=? AND academic_period_id=? AND status='published'").get(plan.universityId, version.groupId, plan.academicYearId, plan.academicPeriodId)?.count ?? 0);
    if (publishedCount !== 1) throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);

    const ics = unfoldIcs(core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ педиатрия ${version.groupId}`,
      preferences: { remindersMinutesBefore: [15] }
    }));
    if (countMatches(ics, /BEGIN:VEVENT/g) !== 97) throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
    if (countMatches(ics, /DTSTART;VALUE=DATE:\d{8}/g) !== 6 || countMatches(ics, /DTEND;VALUE=DATE:\d{8}/g) !== 6) {
      throw new Error(`group ${version.groupId} ICS all-day timing verification failed`);
    }
    if (countMatches(ics, /DTSTART:\d{8}T\d{6}/g) !== 91) throw new Error(`group ${version.groupId} ICS floating timing verification failed`);
    if (countMatches(ics, /BEGIN:VALARM/g) !== 91) throw new Error(`group ${version.groupId} ICS reminder/date-only alarm boundary verification failed`);
    for (const event of published.events.filter((item) => item.timeSemantics === 'date-only')) {
      const uid = `UID:${event.eventId}@medical-calendar`;
      if (!ics.includes(uid)) throw new Error(`group ${version.groupId} missing date-only UID ${event.eventId}`);
      const block = ics.split(uid)[1]?.split('END:VEVENT')[0] ?? '';
      if (/BEGIN:VALARM/.test(block) || /DTSTART[^\r\n]*T\d{6}/.test(block) || /DTEND[^\r\n]*T\d{6}/.test(block)) {
        throw new Error(`group ${version.groupId} date-only event ${event.eventId} acquired synthetic timing/alarm`);
      }
    }
  }

  if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('post-publication SQLite integrity_check failed');
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('post-publication SQLite foreign_key_check failed');
  console.log(JSON.stringify({
    result: 'PRODUCTION_PEDIATRICS_COURSE_6_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    groupCount: 7,
    eventCount: 679,
    floatingEventCount: 637,
    dateOnlyEventCount: 42,
    oldScheduleVersionRowsPreserved: true
  }, null, 2));
} finally {
  database.close();
}
