#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applySchedulePublicationPlan } from './apply-schedule-publication-plan.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

async function verifyCoreBoundary(coreRoot, coreEvidence) {
  const deployedCommit = (await readFile(resolve(coreRoot, '.deployed-commit'), 'utf8')).trim();
  if (!/^[0-9a-f]{40}$/.test(deployedCommit)) {
    throw new Error(`deployed core commit marker is invalid: ${deployedCommit}`);
  }
  if (deployedCommit !== coreEvidence.productionRuntimeCommit) {
    throw new Error(`deployed core commit mismatch: ${deployedCommit}`);
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
  return { commit: deployedCommit, schemaBlob, rendererBlob };
}

function validatePublicationInput({
  apply,
  plan,
  qaForPublication,
  result,
  verifyDatabaseState,
  verifyPublishedIcs,
  preflightMetadata,
  resultMetadata
}) {
  if (typeof apply !== 'boolean') throw new TypeError('apply must be a boolean');
  if (!plan || typeof plan !== 'object') throw new TypeError('plan is required');
  if (plan.universityId !== 'kirov-gmu') throw new Error(`unexpected universityId: ${plan.universityId}`);
  if (plan.programId !== 'dentistry') throw new Error(`unexpected programId: ${plan.programId}`);
  if (!Array.isArray(plan.events) || plan.events.length === 0) throw new TypeError('plan.events must be non-empty');
  if (!Array.isArray(plan.versions) || plan.versions.length === 0) throw new TypeError('plan.versions must be non-empty');
  if (!plan.publication || typeof plan.publication !== 'object') throw new TypeError('plan.publication is required');
  if (!Array.isArray(plan.publication.facultativeIds)) throw new TypeError('plan.publication.facultativeIds must be an array');
  if (!plan.coreEvidence || typeof plan.coreEvidence !== 'object') throw new TypeError('plan.coreEvidence is required');
  if (!qaForPublication || qaForPublication.decision !== 'pass') throw new Error('qaForPublication must be a passing QA report');
  if (typeof result !== 'string' || result.length === 0) throw new TypeError('result is required');
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

function verifyStandardPublishedIcs({ core, published, version, plan, unfoldIcs, countVevents }) {
  const defaultIcs = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ стоматология ${version.groupId}`
  }));
  const expectedDefaultCount = plan.publication.groupDefaultVisibleEventCounts[version.groupId];
  if (countVevents(defaultIcs) !== expectedDefaultCount) {
    throw new Error(`group ${version.groupId} default-off facultative ICS count verification failed`);
  }

  const allFacultativeChoices = Object.fromEntries(
    plan.publication.facultativeIds.map((facultativeId) => [facultativeId, true])
  );
  const allChoicesIcs = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ стоматология ${version.groupId}`,
    preferences: { facultativeChoices: allFacultativeChoices }
  }));
  if (countVevents(allChoicesIcs) !== version.eventCount) {
    throw new Error(`group ${version.groupId} all-facultatives ICS VEVENT count verification failed`);
  }
  if (published.events.some((event) => event.assessment) && !allChoicesIcs.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }
}

export async function runDentistryPublication({
  apply,
  plan,
  qaForPublication,
  result,
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
    eventSetDigest: plan.eventSetDigest,
    eventCount: plan.events.length,
    ...preflightMetadata,
    facultativeIds: plan.publication.facultativeIds,
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
    const applied = await applySchedulePublicationPlan({
      core,
      database,
      plan,
      qaForPublication,
      verifyDatabaseState,
      verifyPublishedIcs: verifyPublishedIcs ?? verifyStandardPublishedIcs
    });

    console.log(JSON.stringify({
      result,
      coreBoundary: boundary,
      groupCount: applied.groupCount,
      eventCount: applied.eventCount,
      oldScheduleVersionRowsPreserved: true,
      ...resultMetadata,
      trialChanged: false,
      checkoutChanged: false,
      subscriptionTokensChanged: false,
      calendarPreferencesChanged: false
    }, null, 2));
  } finally {
    database.close();
  }
}
