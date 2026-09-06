#!/usr/bin/env node
import { canonicalJson, sha256Hex } from '../../src/explicit-decisions.js';

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

function validateOptionalHook(name, hook) {
  if (hook != null && typeof hook !== 'function') {
    throw new TypeError(`${name} must be a function when provided`);
  }
}

function validateInput({
  core,
  database,
  plan,
  qaForPublication,
  verifyDatabaseState,
  prepareDatabase,
  beforePublication,
  verifyConflictingPublishedVersion,
  afterPublish,
  verifyPublishedIcs,
  onPublicationError
}) {
  if (!core || typeof core !== 'object') throw new TypeError('core is required');
  if (!database || typeof database.prepare !== 'function') throw new TypeError('database is required');
  if (!plan || typeof plan !== 'object') throw new TypeError('plan is required');
  if (!Array.isArray(plan.events) || plan.events.length === 0) throw new TypeError('plan.events must be non-empty');
  if (!Array.isArray(plan.versions) || plan.versions.length === 0) throw new TypeError('plan.versions must be non-empty');
  if (typeof plan.candidateDigest !== 'string' || plan.candidateDigest.length === 0) {
    throw new TypeError('plan.candidateDigest is required');
  }
  if (!plan.parsingResult || typeof plan.parsingResult !== 'object') throw new TypeError('plan.parsingResult is required');
  if (!qaForPublication || qaForPublication.decision !== 'pass') {
    throw new Error('qaForPublication must be a passing QA report');
  }
  validateOptionalHook('verifyDatabaseState', verifyDatabaseState);
  validateOptionalHook('prepareDatabase', prepareDatabase);
  validateOptionalHook('beforePublication', beforePublication);
  validateOptionalHook('verifyConflictingPublishedVersion', verifyConflictingPublishedVersion);
  validateOptionalHook('afterPublish', afterPublish);
  if (typeof verifyPublishedIcs !== 'function') throw new TypeError('verifyPublishedIcs must be a function');
  validateOptionalHook('onPublicationError', onPublicationError);
  for (const name of ['createSqliteScheduleRepository', 'createReadyScheduleVersion', 'renderPublishedScheduleIcs']) {
    if (typeof core[name] !== 'function') throw new Error(`deployed core is missing ${name}`);
  }
}

export async function applySchedulePublicationPlan({
  core,
  database,
  plan,
  qaForPublication,
  verifyDatabaseState = null,
  prepareDatabase = null,
  beforePublication = null,
  verifyConflictingPublishedVersion = null,
  afterPublish = null,
  verifyPublishedIcs,
  onPublicationError = null
}) {
  validateInput({
    core,
    database,
    plan,
    qaForPublication,
    verifyDatabaseState,
    prepareDatabase,
    beforePublication,
    verifyConflictingPublishedVersion,
    afterPublish,
    verifyPublishedIcs,
    onPublicationError
  });

  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);
  if (verifyDatabaseState) await verifyDatabaseState({ database, phase: 'before-publication' });

  if (prepareDatabase) {
    await prepareDatabase({
      core,
      database,
      plan,
      qaForPublication
    });
  }

  const repository = core.createSqliteScheduleRepository(database);
  const publicationContext = beforePublication
    ? await beforePublication({
      core,
      database,
      repository,
      plan,
      qaForPublication
    })
    : null;

  try {
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
        if (current.scheduleVersion.versionId === version.versionId) {
          if (current.events.length !== version.eventCount || eventSetDigest(current.events) !== expectedDigest) {
            throw new Error(`group ${version.groupId} published target does not match the approved candidate`);
          }
          console.log(`group ${version.groupId}: already published and verified; skipping`);
          continue;
        }

        if (!verifyConflictingPublishedVersion) {
          throw new Error(`group ${version.groupId} already has another published production version ${current.scheduleVersion.versionId}`);
        }
        await verifyConflictingPublishedVersion({
          core,
          database,
          repository,
          plan,
          version,
          current,
          expectedEvents,
          expectedDigest,
          publicationContext
        });
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
      if (afterPublish) {
        await afterPublish({
          core,
          database,
          repository,
          plan,
          version,
          publicationContext
        });
      }
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

      await verifyPublishedIcs({
        core,
        database,
        repository,
        published,
        version,
        plan,
        unfoldIcs,
        countVevents,
        publicationContext
      });
    }

    const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (finalIntegrity !== 'ok') throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
    if (verifyDatabaseState) await verifyDatabaseState({ database, phase: 'after-publication' });

    return {
      groupCount: plan.versions.length,
      eventCount: plan.events.length
    };
  } catch (error) {
    if (onPublicationError) {
      try {
        await onPublicationError({
          error,
          core,
          database,
          repository,
          plan,
          publicationContext
        });
      } catch (handlerError) {
        console.error(
          `PUBLICATION_ERROR_HANDLER_FAILED: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`
        );
      }
    }
    throw error;
  }
}
