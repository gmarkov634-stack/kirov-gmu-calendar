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
import { toCorePublicationQa } from '../src/medicine-publication-plan.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

const GROUPS = Array.from({ length: 16 }, (_, index) => String(501 + index));
const APPROVED_SOURCE_SHA256 = '43ecb37de9db7ba69153c8514f62de0b058e51c2032e0ee320b117378a740c62';
const APPROVED_CANDIDATE_DIGEST = 'sha256:369dbe3d7e0aa5709e06ba0ab0ed1c079d0ec88f89216fe869cbc331ac60f7a1';
const APPROVED_EVENT_COUNT = 2400;
const EXPECTED_EVENTS_PER_GROUP = 150;
const VERSION_SUFFIX = APPROVED_CANDIDATE_DIGEST.replace('sha256:', '').slice(0, 16);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
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

async function verifyCoreBoundary(coreRoot, coreEvidence) {
  const [schema, renderer] = await Promise.all([
    readFile(resolve(coreRoot, 'contracts/normalized-event.schema.json')),
    readFile(resolve(coreRoot, 'src/calendar/ics-renderer.js'))
  ]);
  const schemaBlob = gitBlobSha(schema);
  const rendererBlob = gitBlobSha(renderer);
  if (schemaBlob !== coreEvidence.normalizedEventSchemaBlob) {
    throw new Error(`deployed core NormalizedEvent schema blob mismatch: ${schemaBlob}`);
  }
  if (rendererBlob !== coreEvidence.icsRendererBlob) {
    throw new Error(`deployed core ICS renderer blob mismatch: ${rendererBlob}`);
  }
  return { schemaBlob, rendererBlob };
}

const [manifest, source, evidence, qa] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-501-516.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-501-516.source.json'),
  readJson('qa/2026-2027-semester-1/medicine-501-516.evidence.json'),
  readJson('qa/2026-2027-semester-1/medicine-501-516.qa-report.json')
]);

if (source.source?.sha256 !== APPROVED_SOURCE_SHA256 || manifest.sourceSha256 !== APPROVED_SOURCE_SHA256) {
  throw new Error('medicine 501-516 official source SHA-256 does not match approved source');
}
if (qa.decision !== 'pass' || qa.candidateDigest !== APPROVED_CANDIDATE_DIGEST) {
  throw new Error('medicine 501-516 QA gate does not match approved PASS candidate');
}
if (qa.checks?.some((check) => check?.status === 'fail')) {
  throw new Error('medicine 501-516 QA contains a failing check');
}
if (evidence.source?.sha256 !== APPROVED_SOURCE_SHA256) {
  throw new Error('medicine 501-516 evidence source SHA-256 mismatch');
}
if (evidence.candidate?.candidateDigest !== APPROVED_CANDIDATE_DIGEST) {
  throw new Error('medicine 501-516 evidence candidate digest mismatch');
}
if (evidence.candidate?.eventCount !== APPROVED_EVENT_COUNT) {
  throw new Error('medicine 501-516 evidence event count mismatch');
}
if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(GROUPS) || JSON.stringify(manifest.groupTable) !== JSON.stringify(GROUPS)) {
  throw new Error('medicine 501-516 group scope must be exactly 501-516');
}

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const candidateDigest = digestNormalizedEvents(events);
if (candidateDigest !== APPROVED_CANDIDATE_DIGEST) {
  throw new Error(`expanded medicine 501-516 candidate digest mismatch: ${candidateDigest}`);
}
if (events.length !== APPROVED_EVENT_COUNT) {
  throw new Error(`expanded medicine 501-516 event count mismatch: ${events.length}`);
}

const groupEventCounts = Object.fromEntries(GROUPS.map((groupId) => [
  groupId,
  events.filter((event) => event.groupId === groupId).length
]));
for (const groupId of GROUPS) {
  const evidenceCount = evidence.candidate?.groupEventCounts?.[groupId];
  if (groupEventCounts[groupId] !== EXPECTED_EVENTS_PER_GROUP || evidenceCount !== EXPECTED_EVENTS_PER_GROUP) {
    throw new Error(`group ${groupId} must contain exactly ${EXPECTED_EVENTS_PER_GROUP} approved events`);
  }
}

const versions = GROUPS.map((groupId) => ({
  groupId,
  versionId: `kgmu-2026-2027-s1-medicine-${groupId}-${VERSION_SUFFIX}`,
  eventCount: EXPECTED_EVENTS_PER_GROUP
}));
const parsingResult = {
  jobId: qa.parsingJobId,
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  events
};

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'preflight',
  universityId: source.universityId,
  academicYearId: source.academicYear,
  academicPeriodId: source.academicPeriodId,
  groups: GROUPS,
  sourceSha256: APPROVED_SOURCE_SHA256,
  candidateDigest: APPROVED_CANDIDATE_DIGEST,
  versionSuffix: VERSION_SUFFIX,
  groupCount: GROUPS.length,
  eventCount: events.length
}, null, 2));

if (!APPLY) {
  console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
  process.exit(0);
}

const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
if (typeof databasePath !== 'string' || databasePath.length === 0) {
  throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
}

const boundary = await verifyCoreBoundary(coreRoot, qa.sharedContractEvidence);
const core = await import(pathToFileURL(resolve(coreRoot, 'src/index.js')).href);
for (const name of [
  'openSqliteRuntimeDatabase',
  'createSqliteScheduleRepository',
  'createReadyScheduleVersion',
  'renderPublishedScheduleIcs'
]) {
  if (typeof core[name] !== 'function') throw new Error(`deployed core is missing ${name}`);
}

const database = core.openSqliteRuntimeDatabase({ path: databasePath });
try {
  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);
  const fkErrors = database.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length !== 0) throw new Error(`SQLite foreign_key_check returned ${fkErrors.length} rows`);

  const repository = core.createSqliteScheduleRepository(database);
  const qaForPublication = toCorePublicationQa(qa);

  for (const version of versions) {
    const expectedEvents = events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const current = await repository.getPublishedSchedule({
      universityId: source.universityId,
      groupId: version.groupId,
      academicYearId: source.academicYear,
      academicPeriodId: source.academicPeriodId
    });

    if (current) {
      if (current.scheduleVersion.versionId !== version.versionId) {
        throw new Error(`group ${version.groupId} already has another published version ${current.scheduleVersion.versionId}`);
      }
      if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) {
        throw new Error(`group ${version.groupId} published target does not match approved candidate`);
      }
      console.log(`group ${version.groupId}: already published and verified; skipping`);
      continue;
    }

    const targetRow = database.prepare('SELECT version_id, status FROM schedule_versions WHERE version_id = ?').get(version.versionId);
    if (targetRow && targetRow.status !== 'ready') {
      throw new Error(`group ${version.groupId} target version has unexpected status ${targetRow.status}`);
    }

    if (targetRow) {
      const rows = database.prepare('SELECT event_json FROM schedule_events WHERE version_id = ? ORDER BY event_id').all(version.versionId);
      const storedEvents = rows.map((row) => JSON.parse(row.event_json));
      if (storedEvents.length !== version.eventCount || eventSetDigest(storedEvents) !== expectedDigest) {
        throw new Error(`group ${version.groupId} ready target does not match approved candidate`);
      }
      console.log(`group ${version.groupId}: resuming verified ready version`);
    } else {
      const snapshot = core.createReadyScheduleVersion({
        parsingResult,
        qaReport: qaForPublication,
        candidateDigest: APPROVED_CANDIDATE_DIGEST,
        groupId: version.groupId,
        versionId: version.versionId
      });
      await repository.saveReadySnapshot({
        academicYearId: source.academicYear,
        scheduleVersion: snapshot.scheduleVersion,
        events: snapshot.events
      });
      console.log(`group ${version.groupId}: saved ready version ${version.versionId}`);
    }

    await repository.publishVersion({ versionId: version.versionId });
    console.log(`group ${version.groupId}: published ${version.versionId}`);
  }

  for (const version of versions) {
    const expectedEvents = events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({
      universityId: source.universityId,
      groupId: version.groupId,
      academicYearId: source.academicYear,
      academicPeriodId: source.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) {
      throw new Error(`group ${version.groupId} final published version verification failed`);
    }
    if (published.events.length !== version.eventCount || eventSetDigest(published.events) !== expectedDigest) {
      throw new Error(`group ${version.groupId} final event-set verification failed`);
    }

    const publishedCount = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM schedule_versions
      WHERE university_id = ? AND group_id = ? AND academic_year_id = ? AND academic_period_id = ? AND status = 'published'
    `).get(source.universityId, version.groupId, source.academicYear, source.academicPeriodId)?.count ?? 0);
    if (publishedCount !== 1) throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);

    const ics = unfoldIcs(core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ ${version.groupId}`
    }));
    if (countVevents(ics) !== version.eventCount) {
      throw new Error(`group ${version.groupId} raw ICS VEVENT count verification failed`);
    }
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  const finalFkErrors = database.prepare('PRAGMA foreign_key_check').all();
  if (finalFkErrors.length !== 0) throw new Error(`post-publication foreign_key_check returned ${finalFkErrors.length} rows`);

  console.log(JSON.stringify({
    result: 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    candidateDigest: APPROVED_CANDIDATE_DIGEST,
    groupCount: versions.length,
    eventCount: events.length,
    trialChanged: false,
    checkoutChanged: false,
    landingChanged: false
  }, null, 2));
} finally {
  database.close();
}
