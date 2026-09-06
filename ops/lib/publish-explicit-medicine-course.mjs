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
} from '../../src/explicit-decisions.js';
import { toCorePublicationQa } from '../../src/medicine-publication-plan.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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

function normalizeEvidence(evidence) {
  return {
    sourceSha256: evidence.sourceSha256 ?? evidence.source?.sha256,
    candidateDigest: evidence.candidateDigest ?? evidence.candidate?.candidateDigest,
    eventCount: evidence.eventCount ?? evidence.candidate?.eventCount,
    groupEventCounts: evidence.groupEventCounts ?? evidence.candidate?.groupEventCounts
  };
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

function validateConfig({
  scope,
  groups,
  approvedSourceSha256,
  approvedCandidateDigest,
  approvedEventCount,
  expectedGroupEventCounts
}) {
  if (typeof scope !== 'string' || scope.length === 0) throw new TypeError('scope is required');
  if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('groups must be a non-empty array');
  if (typeof approvedSourceSha256 !== 'string' || approvedSourceSha256.length === 0) {
    throw new TypeError('approvedSourceSha256 is required');
  }
  if (typeof approvedCandidateDigest !== 'string' || approvedCandidateDigest.length === 0) {
    throw new TypeError('approvedCandidateDigest is required');
  }
  if (!Number.isInteger(approvedEventCount) || approvedEventCount <= 0) {
    throw new TypeError('approvedEventCount must be a positive integer');
  }
  if (!expectedGroupEventCounts || typeof expectedGroupEventCounts !== 'object' || Array.isArray(expectedGroupEventCounts)) {
    throw new TypeError('expectedGroupEventCounts must be an object');
  }
  for (const groupId of groups) {
    if (!Number.isInteger(expectedGroupEventCounts[groupId]) || expectedGroupEventCounts[groupId] <= 0) {
      throw new TypeError(`expectedGroupEventCounts.${groupId} must be a positive integer`);
    }
  }
}

export async function runExplicitMedicineCoursePublication({
  scope,
  groups,
  approvedSourceSha256,
  approvedCandidateDigest,
  approvedEventCount,
  expectedGroupEventCounts,
  includeGroupEventCountsInSummary = false,
  compatibleRendererBlobs = [],
  reportRendererCompatibility = false,
  verifyPublishedIcs,
  formatIcsVerificationLog,
  finalResultFields = {}
}) {
  validateConfig({
    scope,
    groups,
    approvedSourceSha256,
    approvedCandidateDigest,
    approvedEventCount,
    expectedGroupEventCounts
  });

  const apply = process.argv.includes('--apply');
  const unknownArgs = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
  if (unknownArgs.length > 0) throw new Error(`unsupported arguments: ${unknownArgs.join(', ')}`);

  const [manifest, source, evidence, qa] = await Promise.all([
    readJson(`fixtures/2026-2027-semester-1/medicine-${scope}.decisions.json`),
    readJson(`fixtures/2026-2027-semester-1/medicine-${scope}.source.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${scope}.evidence.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${scope}.qa-report.json`)
  ]);
  const normalizedEvidence = normalizeEvidence(evidence);

  if (source.source?.sha256 !== approvedSourceSha256 || manifest.sourceSha256 !== approvedSourceSha256) {
    throw new Error(`medicine ${scope} official source SHA-256 does not match approved source`);
  }
  if (qa.decision !== 'pass' || qa.candidateDigest !== approvedCandidateDigest) {
    throw new Error(`medicine ${scope} QA gate does not match approved PASS candidate`);
  }
  if (qa.checks?.some((check) => check?.status === 'fail')) {
    throw new Error(`medicine ${scope} QA contains a failing check`);
  }
  if (normalizedEvidence.sourceSha256 !== approvedSourceSha256) {
    throw new Error(`medicine ${scope} evidence source SHA-256 mismatch`);
  }
  if (normalizedEvidence.candidateDigest !== approvedCandidateDigest) {
    throw new Error(`medicine ${scope} evidence candidate digest mismatch`);
  }
  if (normalizedEvidence.eventCount !== approvedEventCount) {
    throw new Error(`medicine ${scope} evidence event count mismatch`);
  }
  if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(groups) || JSON.stringify(manifest.groupTable) !== JSON.stringify(groups)) {
    throw new Error(`medicine ${scope} group scope must be exactly ${scope}`);
  }

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== approvedCandidateDigest) {
    throw new Error(`expanded medicine ${scope} candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== approvedEventCount) {
    throw new Error(`expanded medicine ${scope} event count mismatch: ${events.length}`);
  }

  const groupEventCounts = Object.fromEntries(groups.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length
  ]));
  for (const groupId of groups) {
    const expectedCount = expectedGroupEventCounts[groupId];
    const evidenceCount = normalizedEvidence.groupEventCounts?.[groupId];
    if (groupEventCounts[groupId] !== expectedCount || evidenceCount !== expectedCount) {
      throw new Error(`group ${groupId} must contain exactly ${expectedCount} approved events`);
    }
  }

  const versionSuffix = approvedCandidateDigest.replace('sha256:', '').slice(0, 16);
  const versions = groups.map((groupId) => ({
    groupId,
    versionId: `kgmu-2026-2027-s1-medicine-${groupId}-${versionSuffix}`,
    eventCount: expectedGroupEventCounts[groupId]
  }));
  const parsingResult = {
    jobId: qa.parsingJobId,
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    events
  };

  const summary = {
    mode: apply ? 'apply' : 'preflight',
    universityId: source.universityId,
    academicYearId: source.academicYear,
    academicPeriodId: source.academicPeriodId,
    groups,
    sourceSha256: approvedSourceSha256,
    candidateDigest: approvedCandidateDigest,
    versionSuffix,
    groupCount: groups.length,
    eventCount: events.length
  };
  if (includeGroupEventCountsInSummary) summary.groupEventCounts = groupEventCounts;
  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
    return;
  }

  const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
  const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
  }

  const boundary = await verifyCoreBoundary(coreRoot, qa.sharedContractEvidence, {
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
          candidateDigest: approvedCandidateDigest,
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

      if (typeof verifyPublishedIcs === 'function') {
        const verification = verifyPublishedIcs({
          renderPublishedScheduleIcs: core.renderPublishedScheduleIcs,
          scheduleVersion: published.scheduleVersion,
          events: published.events,
          calendarName: `КГМУ ${version.groupId}`
        });
        if (typeof formatIcsVerificationLog === 'function') {
          console.log(formatIcsVerificationLog({ groupId: version.groupId, verification }));
        }
      } else {
        const ics = unfoldIcs(core.renderPublishedScheduleIcs({
          scheduleVersion: published.scheduleVersion,
          events: published.events,
          calendarName: `КГМУ ${version.groupId}`
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
    const finalFkErrors = database.prepare('PRAGMA foreign_key_check').all();
    if (finalFkErrors.length !== 0) throw new Error(`post-publication foreign_key_check returned ${finalFkErrors.length} rows`);

    console.log(JSON.stringify({
      result: 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
      coreBoundary: boundary,
      candidateDigest: approvedCandidateDigest,
      groupCount: versions.length,
      eventCount: events.length,
      ...finalResultFields,
      trialChanged: false,
      checkoutChanged: false,
      landingChanged: false
    }, null, 2));
  } finally {
    database.close();
  }
}
