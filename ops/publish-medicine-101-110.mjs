#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildMedicinePublicationPlan,
  toCorePublicationQa
} from '../src/medicine-publication-plan.js';
import { canonicalJson, sha256Hex } from '../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => arg !== '--apply' && arg !== '--preflight');
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

function eventSetDigest(events) {
  const sorted = [...events].sort((a, b) => a.eventId.localeCompare(b.eventId));
  return sha256Hex(canonicalJson(sorted));
}

function countVevents(ics) {
  return (ics.match(/BEGIN:VEVENT/g) ?? []).length;
}

async function loadPlan() {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);
  return { plan: buildMedicinePublicationPlan({ manifest, source, evidence, qa }), qa };
}

async function verifyCoreBoundary(coreRoot, coreEvidence) {
  const schemaPath = resolve(coreRoot, 'contracts/normalized-event.schema.json');
  const rendererPath = resolve(coreRoot, 'src/calendar/ics-renderer.js');
  const [schema, renderer] = await Promise.all([readFile(schemaPath), readFile(rendererPath)]);
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

const { plan, qa } = await loadPlan();
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'preflight',
  universityId: plan.universityId,
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
if (typeof databasePath !== 'string' || databasePath.length === 0) {
  throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
}

const boundary = await verifyCoreBoundary(coreRoot, plan.coreEvidence);
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

  const repository = core.createSqliteScheduleRepository(database);
  const qaForPublication = toCorePublicationQa(qa);

  for (const version of plan.versions) {
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const current = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });

    if (current && current.scheduleVersion.versionId !== version.versionId) {
      throw new Error(
        `group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}; replacement is not allowed by this first-publication runner`
      );
    }

    if (current) {
      if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) {
        throw new Error(`group ${version.groupId} published target does not match the approved candidate`);
      }
      console.log(`group ${version.groupId}: already published and verified; skipping`);
      continue;
    }

    const targetRow = database.prepare(
      'SELECT version_id, status FROM schedule_versions WHERE version_id = ?'
    ).get(version.versionId);

    if (targetRow && targetRow.status !== 'ready') {
      throw new Error(`group ${version.groupId} target version has unexpected status ${targetRow.status}`);
    }

    if (targetRow) {
      const storedRows = database.prepare(
        'SELECT event_json FROM schedule_events WHERE version_id = ? ORDER BY event_id'
      ).all(version.versionId);
      const storedEvents = storedRows.map((row) => JSON.parse(row.event_json));
      if (storedEvents.length !== version.eventCount || eventSetDigest(storedEvents) !== expectedDigest) {
        throw new Error(`group ${version.groupId} ready target does not match the approved candidate`);
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
    const published = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) {
      throw new Error(`group ${version.groupId} final published version verification failed`);
    }
    if (published.events.length !== version.eventCount) {
      throw new Error(`group ${version.groupId} final event count verification failed`);
    }
    const ics = core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ ${version.groupId}`
    });
    if (countVevents(ics) !== version.eventCount) {
      throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
    }
    if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) {
      throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
    }
    if (published.events.some((event) => event.lessonType === 'graded-credit') && !ics.includes('ЗАЧЕТ С ОЦЕНКОЙ')) {
      throw new Error(`group ${version.groupId} graded-credit summary is missing from rendered ICS`);
    }
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  console.log(JSON.stringify({
    result: 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    groupCount: plan.versions.length,
    eventCount: plan.events.length,
    trialChanged: false,
    checkoutChanged: false
  }, null, 2));
} finally {
  database.close();
}
