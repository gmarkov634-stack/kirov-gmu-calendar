#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalJson, sha256Hex } from '../../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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

async function verifyCoreBoundary(coreRoot, coreEvidence, {
  requireProductionRuntimeCommit,
  includeApprovedMainCommit
}) {
  let deployedCommit = null;
  const approvedProductionCommit = coreEvidence.productionRuntimeCommit;
  if (requireProductionRuntimeCommit || approvedProductionCommit != null) {
    deployedCommit = (await readFile(resolve(coreRoot, '.deployed-commit'), 'utf8')).trim();
    if (!/^[0-9a-f]{40}$/.test(deployedCommit)) {
      throw new Error(`deployed core commit marker is invalid: ${deployedCommit}`);
    }
    if (typeof approvedProductionCommit !== 'string' || !/^[0-9a-f]{40}$/.test(approvedProductionCommit)) {
      throw new Error('approved production core commit is missing or invalid');
    }
    if (deployedCommit !== approvedProductionCommit) {
      throw new Error(`deployed core commit mismatch: ${deployedCommit}`);
    }
  }

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
  return {
    ...(deployedCommit == null ? {} : { commit: deployedCommit }),
    ...(includeApprovedMainCommit ? { approvedMainCommit: coreEvidence.commit } : {}),
    schemaBlob,
    rendererBlob
  };
}

function validatePublicationInput({
  apply,
  plan,
  qaForPublication,
  result,
  requireProductionRuntimeCommit,
  includeApprovedMainCommit,
  validateCoreEvidence,
  verifyDatabaseState,
  verifyPublishedIcs,
  preflightMetadata,
  resultMetadata
}) {
  if (typeof apply !== 'boolean') throw new TypeError('apply must be a boolean');
  if (!plan || typeof plan !== 'object') throw new TypeError('plan is required');
  if (plan.universityId !== 'kirov-gmu') throw new Error(`unexpected universityId: ${plan.universityId}`);
  if (plan.programId !== 'pediatrics') throw new Error(`unexpected programId: ${plan.programId}`);
  if (!Array.isArray(plan.events) || plan.events.length === 0) throw new TypeError('plan.events must be non-empty');
  if (!Array.isArray(plan.versions) || plan.versions.length === 0) throw new TypeError('plan.versions must be non-empty');
  if (!plan.coreEvidence || typeof plan.coreEvidence !== 'object') throw new TypeError('plan.coreEvidence is required');
  if (!qaForPublication || qaForPublication.decision !== 'pass') throw new Error('qaForPublication must be a passing QA report');
  if (typeof result !== 'string' || result.length === 0) throw new TypeError('result is required');
  if (typeof requireProductionRuntimeCommit !== 'boolean') {
    throw new TypeError('requireProductionRuntimeCommit must be a boolean');
  }
  if (typeof includeApprovedMainCommit !== 'boolean') {
    throw new TypeError('includeApprovedMainCommit must be a boolean');
  }
  if (validateCoreEvidence != null && typeof validateCoreEvidence !== 'function') {
    throw new TypeError('validateCoreEvidence must be a function when provided');
  }
  if (verifyDatabaseState != null && typeof verifyDatabaseState !== 'function') {
    throw new TypeError('verifyDatabaseState must be a function when provided');
  }
  if (verifyPublishedIcs != null && typeof verifyPublishedIcs !== 'function') {
    throw new TypeError('verifyPublishedIcs must be a function when provided');
  }
  if (!preflightMetadata || typeof preflightMetadata !== 'object' || Array.isArray(preflightMetadata)) {
    throw new TypeError('preflightMetadata must be an object');
  }
  if (!resultMetadata || typeof resultMetadata !== 'object' || Array.isArray(resultMetadata)) {
    throw new TypeError('resultMetadata must be an object');
  }
}

function verifyStandardPublishedIcs({ core, published, version }) {
  const ics = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`
  }));
  if (countVevents(ics) !== version.eventCount) {
    throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
  }
  if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }
}

export async function runPediatricsPublication({
  apply,
  plan,
  qaForPublication,
  result,
  requireProductionRuntimeCommit = true,
  includeApprovedMainCommit = false,
  validateCoreEvidence = null,
  verifyDatabaseState = null,
  verifyPublishedIcs = null,
  preflightMetadata = {},
  resultMetadata = {}
}) {
  validatePublicationInput({
    apply,
    plan,
    qaForPublication,
    result,
    requireProductionRuntimeCommit,
    includeApprovedMainCommit,
    validateCoreEvidence,
    verifyDatabaseState,
    verifyPublishedIcs,
    preflightMetadata,
    resultMetadata
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preflight',
    universityId: plan.universityId,
    programId: plan.programId,
    academicYearId: plan.academicYearId,
    academicPeriodId: plan.academicPeriodId,
    sourceSha256: plan.sourceSha256,
    candidateDigest: plan.candidateDigest,
    eventCount: plan.events.length,
    ...preflightMetadata,
    versions: plan.versions
  }, null, 2));

  if (!apply) {
    console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
    return;
  }

  const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
  const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
  }

  if (validateCoreEvidence) await validateCoreEvidence(plan.coreEvidence);
  const boundary = await verifyCoreBoundary(coreRoot, plan.coreEvidence, {
    requireProductionRuntimeCommit,
    includeApprovedMainCommit
  });
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
    if (verifyDatabaseState) await verifyDatabaseState({ database, phase: 'before-publication' });

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
      if (published.events.length !== version.eventCount || eventSetDigest(published.events) !== expectedDigest) {
        throw new Error(`group ${version.groupId} final event-set verification failed`);
      }

      const publishedCount = Number(database.prepare(`
        SELECT COUNT(*) AS count FROM schedule_versions
        WHERE university_id = ? AND group_id = ? AND academic_year_id = ? AND academic_period_id = ? AND status = 'published'
      `).get(
        plan.universityId,
        version.groupId,
        plan.academicYearId,
        plan.academicPeriodId
      )?.count ?? 0);
      if (publishedCount !== 1) {
        throw new Error(`group ${version.groupId} must have exactly one published version, got ${publishedCount}`);
      }

      if (verifyPublishedIcs) {
        await verifyPublishedIcs({ core, published, version, unfoldIcs, countVevents });
      } else {
        verifyStandardPublishedIcs({ core, published, version });
      }
    }

    const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
    if (verifyDatabaseState) await verifyDatabaseState({ database, phase: 'after-publication' });
    console.log(JSON.stringify({
      result,
      coreBoundary: boundary,
      groupCount: plan.versions.length,
      eventCount: plan.events.length,
      oldScheduleVersionRowsPreserved: true,
      ...resultMetadata
    }, null, 2));
  } finally {
    database.close();
  }
}
