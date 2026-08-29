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
const REPLACE_EXISTING = process.argv.includes('--replace-existing');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => ![
  '--apply',
  '--preflight',
  '--replace-existing'
].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

const EXPECTED_PREVIOUS_CANDIDATE_DIGEST =
  'sha256:5282de1dcec279ac4d035d55ea57d293d8ed0294ecc1cb0e3446e7a4e7a3f20a';
const EXPECTED_PREVIOUS_VERSION_SUFFIX = EXPECTED_PREVIOUS_CANDIDATE_DIGEST
  .replace(/^sha256:/, '')
  .slice(0, 16);

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

function unfoldIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

function countVevents(ics) {
  return (ics.match(/BEGIN:VEVENT/g) ?? []).length;
}

function expectedPreviousVersionId(groupId) {
  return `kgmu-2026-2027-s1-medicine-${groupId}-${EXPECTED_PREVIOUS_VERSION_SUFFIX}`;
}

async function loadPlan() {
  const [manifest, facultatives, source, evidence, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);
  return { plan: buildMedicinePublicationPlan({ manifest, facultatives, source, evidence, qa }), qa };
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
const previousVersions = plan.versions.map((version) => ({
  groupId: version.groupId,
  versionId: expectedPreviousVersionId(version.groupId),
  eventCount: plan.events.filter((event) => (
    event.groupId === version.groupId && event.facultativeId == null
  )).length
}));

console.log(JSON.stringify({
  mode: APPLY
    ? (REPLACE_EXISTING ? 'apply-replacement' : 'apply')
    : (REPLACE_EXISTING ? 'preflight-replacement' : 'preflight'),
  universityId: plan.universityId,
  academicYearId: plan.academicYearId,
  academicPeriodId: plan.academicPeriodId,
  sourceSha256: plan.sourceSha256,
  candidateDigest: plan.candidateDigest,
  eventCount: plan.events.length,
  versions: plan.versions,
  ...(REPLACE_EXISTING ? {
    expectedPreviousCandidateDigest: EXPECTED_PREVIOUS_CANDIDATE_DIGEST,
    previousVersions
  } : {})
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
    const expectedPreviousEvents = expectedEvents.filter((event) => event.facultativeId == null);
    const expectedPreviousDigest = eventSetDigest(expectedPreviousEvents);
    const previousVersionId = expectedPreviousVersionId(version.groupId);
    const current = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });

    if (current && current.scheduleVersion.versionId !== version.versionId) {
      if (!REPLACE_EXISTING) {
        throw new Error(
          `group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}; rerun with --replace-existing only after controlled production preflight`
        );
      }
      if (current.scheduleVersion.versionId !== previousVersionId) {
        throw new Error(
          `group ${version.groupId} current published version ${current.scheduleVersion.versionId} is not the expected replacement source ${previousVersionId}`
        );
      }
      if (
        current.events.length !== expectedPreviousEvents.length
        || eventSetDigest(current.events) !== expectedPreviousDigest
      ) {
        throw new Error(`group ${version.groupId} current published source does not match the approved previous candidate`);
      }
      console.log(`group ${version.groupId}: verified replacement source ${previousVersionId}`);
    }

    if (current?.scheduleVersion.versionId === version.versionId) {
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
    const expectedEvents = plan.events.filter((event) => event.groupId === version.groupId);
    const expectedDigest = eventSetDigest(expectedEvents);
    const published = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId: version.groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    if (!published || published.scheduleVersion.versionId !== version.versionId) {
      throw new Error(`group ${version.groupId} final published version verification failed`);
    }
    if (
      published.events.length !== version.eventCount
      || eventSetDigest(published.events) !== expectedDigest
    ) {
      throw new Error(`group ${version.groupId} final event set verification failed`);
    }

    const publishedCount = Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM schedule_versions
      WHERE university_id = ?
        AND group_id = ?
        AND academic_year_id = ?
        AND academic_period_id = ?
        AND status = 'published'
    `).get(
      plan.universityId,
      version.groupId,
      plan.academicYearId,
      plan.academicPeriodId
    )?.count ?? 0);
    if (publishedCount !== 1) {
      throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);
    }

    const defaultVisibleEvents = published.events.filter((event) => event.facultativeId == null);
    const defaultIcs = core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ ${version.groupId}`
    });
    const unfoldedDefaultIcs = unfoldIcs(defaultIcs);
    if (countVevents(unfoldedDefaultIcs) !== defaultVisibleEvents.length) {
      throw new Error(`group ${version.groupId} default-off ICS VEVENT count verification failed`);
    }

    const allFacultativeChoices = Object.fromEntries(
      published.events
        .filter((event) => event.facultativeId != null)
        .map((event) => [event.facultativeId, true])
    );
    const allFacultativesIcs = core.renderPublishedScheduleIcs({
      scheduleVersion: published.scheduleVersion,
      events: published.events,
      calendarName: `КГМУ ${version.groupId}`,
      preferences: { facultativeChoices: allFacultativeChoices }
    });
    const unfoldedAllFacultativesIcs = unfoldIcs(allFacultativesIcs);
    if (countVevents(unfoldedAllFacultativesIcs) !== version.eventCount) {
      throw new Error(`group ${version.groupId} all-facultatives ICS VEVENT count verification failed`);
    }

    if (REPLACE_EXISTING) {
      const previousVersionId = expectedPreviousVersionId(version.groupId);
      const previousRow = database.prepare(
        'SELECT status FROM schedule_versions WHERE version_id = ?'
      ).get(previousVersionId);
      if (!previousRow || previousRow.status !== 'superseded') {
        throw new Error(`group ${version.groupId} previous version was not preserved as superseded`);
      }
    }

    if (defaultVisibleEvents.some((event) => event.assessment) && !unfoldedDefaultIcs.includes('DESCRIPTION:')) {
      throw new Error(`group ${version.groupId} assessment metadata is missing from default rendered ICS`);
    }
    if (
      defaultVisibleEvents.some((event) => event.lessonType === 'graded-credit') &&
      !unfoldedDefaultIcs.includes('ЗАЧЕТ С ОЦЕНКОЙ')
    ) {
      throw new Error(`group ${version.groupId} graded-credit summary is missing from default rendered ICS`);
    }
  }

  const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
  console.log(JSON.stringify({
    result: REPLACE_EXISTING
      ? 'PRODUCTION_SCHEDULES_REPLACED_AND_VERIFIED'
      : 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary: boundary,
    groupCount: plan.versions.length,
    eventCount: plan.events.length,
    previousVersionsPreserved: REPLACE_EXISTING,
    trialChanged: false,
    checkoutChanged: false
  }, null, 2));
} finally {
  database.close();
}
