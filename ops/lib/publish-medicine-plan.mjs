#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonicalJson, sha256Hex } from '../../src/explicit-decisions.js';

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
  compatibleRendererBlobs = [],
  reportRendererCompatibility = false
} = {}) {
  const [schema, renderer] = await Promise.all([
    readFile(resolve(coreRoot, 'contracts/normalized-event.schema.json')),
    readFile(resolve(coreRoot, 'src/calendar/ics-renderer.js'))
  ]);
  const schemaBlob = gitBlobSha(schema);
  const rendererBlob = gitBlobSha(renderer);
  if (schemaBlob !== coreEvidence.normalizedEventSchemaBlob) {
    throw new Error(`deployed core NormalizedEvent schema blob mismatch: ${schemaBlob}`);
  }

  const compatible = new Set([
    coreEvidence.icsRendererBlob,
    ...compatibleRendererBlobs.map(({ blob }) => blob)
  ]);
  if (!compatible.has(rendererBlob)) {
    throw new Error(`deployed core ICS renderer blob mismatch: ${rendererBlob}`);
  }

  const boundary = { schemaBlob, rendererBlob };
  if (reportRendererCompatibility) {
    boundary.rendererCompatibility = rendererBlob === coreEvidence.icsRendererBlob
      ? 'qa-evidence'
      : compatibleRendererBlobs.find(({ blob }) => blob === rendererBlob)?.label ?? 'compatible-override';
  }
  return boundary;
}

function validateInput({
  plan,
  qaForPublication,
  coreEvidence,
  compatibleRendererBlobs,
  verifyForeignKeys,
  verifyPublishedIcs,
  formatIcsVerificationLog,
  result,
  resultFields
}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('plan is required');
  if (plan.universityId !== 'kirov-gmu') throw new Error(`unexpected universityId: ${plan.universityId}`);
  if (!Array.isArray(plan.events) || plan.events.length === 0) throw new TypeError('plan.events must be non-empty');
  if (!Array.isArray(plan.versions) || plan.versions.length === 0) throw new TypeError('plan.versions must be non-empty');
  if (typeof plan.candidateDigest !== 'string' || plan.candidateDigest.length === 0) {
    throw new TypeError('plan.candidateDigest is required');
  }
  if (!plan.parsingResult || typeof plan.parsingResult !== 'object') throw new TypeError('plan.parsingResult is required');
  if (!qaForPublication || qaForPublication.decision !== 'pass') {
    throw new Error('qaForPublication must be a passing QA report');
  }
  if (!coreEvidence || typeof coreEvidence !== 'object') throw new TypeError('coreEvidence is required');
  if (!Array.isArray(compatibleRendererBlobs)) throw new TypeError('compatibleRendererBlobs must be an array');
  if (typeof verifyForeignKeys !== 'boolean') throw new TypeError('verifyForeignKeys must be a boolean');
  if (verifyPublishedIcs != null && typeof verifyPublishedIcs !== 'function') {
    throw new TypeError('verifyPublishedIcs must be a function when provided');
  }
  if (formatIcsVerificationLog != null && typeof formatIcsVerificationLog !== 'function') {
    throw new TypeError('formatIcsVerificationLog must be a function when provided');
  }
  if (typeof result !== 'string' || result.length === 0) throw new TypeError('result is required');
  if (!resultFields || typeof resultFields !== 'object' || Array.isArray(resultFields)) {
    throw new TypeError('resultFields must be an object');
  }
}

function verifyForeignKeyState(database, phase) {
  const fkErrors = database.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length === 0) return;
  const prefix = phase === 'after-publication' ? 'post-publication ' : '';
  throw new Error(`${prefix}foreign_key_check returned ${fkErrors.length} rows`);
}

export async function applyMedicinePublicationPlan({
  plan,
  qaForPublication,
  coreEvidence,
  compatibleRendererBlobs = [],
  reportRendererCompatibility = false,
  verifyForeignKeys = false,
  verifyPublishedIcs = null,
  formatIcsVerificationLog = null,
  result = 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
  resultFields = {}
}) {
  validateInput({
    plan,
    qaForPublication,
    coreEvidence,
    compatibleRendererBlobs,
    verifyForeignKeys,
    verifyPublishedIcs,
    formatIcsVerificationLog,
    result,
    resultFields
  });

  const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
  const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
  }

  const boundary = await verifyCoreBoundary(coreRoot, coreEvidence, {
    compatibleRendererBlobs,
    reportRendererCompatibility
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
    if (verifyForeignKeys) verifyForeignKeyState(database, 'before-publication');

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
          throw new Error(`group ${version.groupId} already has another published version ${current.scheduleVersion.versionId}`);
        }
        if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) {
          throw new Error(`group ${version.groupId} published target does not match approved candidate`);
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
          throw new Error(`group ${version.groupId} ready target does not match approved candidate`);
        }
        console.log(`group ${version.groupId}: resuming verified ready version`);
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

      const calendarName = `КГМУ ${version.groupId}`;
      if (verifyPublishedIcs) {
        const verification = await verifyPublishedIcs({
          core,
          renderPublishedScheduleIcs: core.renderPublishedScheduleIcs,
          published,
          scheduleVersion: published.scheduleVersion,
          events: published.events,
          version,
          plan,
          calendarName,
          unfoldIcs,
          countVevents
        });
        if (formatIcsVerificationLog) {
          console.log(formatIcsVerificationLog({ groupId: version.groupId, verification }));
        }
      } else {
        const ics = unfoldIcs(core.renderPublishedScheduleIcs({
          scheduleVersion: published.scheduleVersion,
          events: published.events,
          calendarName
        }));
        if (countVevents(ics) !== version.eventCount) {
          throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
        }
        if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) {
          throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
        }
      }
    }

    const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
    if (verifyForeignKeys) verifyForeignKeyState(database, 'after-publication');

    console.log(JSON.stringify({
      result,
      coreBoundary: boundary,
      groupCount: plan.versions.length,
      eventCount: plan.events.length,
      ...resultFields,
      trialChanged: false,
      checkoutChanged: false
    }, null, 2));
  } finally {
    database.close();
  }
}
