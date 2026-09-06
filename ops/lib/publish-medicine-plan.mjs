#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { applySchedulePublicationPlan } from './apply-schedule-publication-plan.mjs';

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
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

function validateOptionalHook(name, hook) {
  if (hook != null && typeof hook !== 'function') {
    throw new TypeError(`${name} must be a function when provided`);
  }
}

function validatePlainObject(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function validateInput({
  plan,
  qaForPublication,
  coreEvidence,
  compatibleRendererBlobs,
  verifyForeignKeys,
  verifyCoreEvidence,
  prepareDatabase,
  beforePublication,
  verifyConflictingPublishedVersion,
  afterPublish,
  verifyPublishedIcs,
  formatIcsVerificationLog,
  onPublicationError,
  result,
  resultFields,
  standardResultFields,
  emitResult
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
  validateOptionalHook('verifyCoreEvidence', verifyCoreEvidence);
  validateOptionalHook('prepareDatabase', prepareDatabase);
  validateOptionalHook('beforePublication', beforePublication);
  validateOptionalHook('verifyConflictingPublishedVersion', verifyConflictingPublishedVersion);
  validateOptionalHook('afterPublish', afterPublish);
  validateOptionalHook('verifyPublishedIcs', verifyPublishedIcs);
  validateOptionalHook('formatIcsVerificationLog', formatIcsVerificationLog);
  validateOptionalHook('onPublicationError', onPublicationError);
  if (typeof result !== 'string' || result.length === 0) throw new TypeError('result is required');
  validatePlainObject('resultFields', resultFields);
  validatePlainObject('standardResultFields', standardResultFields);
  if (typeof emitResult !== 'boolean') throw new TypeError('emitResult must be a boolean');
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
  verifyCoreEvidence = null,
  prepareDatabase = null,
  beforePublication = null,
  verifyConflictingPublishedVersion = null,
  afterPublish = null,
  verifyPublishedIcs = null,
  formatIcsVerificationLog = null,
  onPublicationError = null,
  result = 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
  resultFields = {},
  standardResultFields = {
    trialChanged: false,
    checkoutChanged: false
  },
  emitResult = true
}) {
  validateInput({
    plan,
    qaForPublication,
    coreEvidence,
    compatibleRendererBlobs,
    verifyForeignKeys,
    verifyCoreEvidence,
    prepareDatabase,
    beforePublication,
    verifyConflictingPublishedVersion,
    afterPublish,
    verifyPublishedIcs,
    formatIcsVerificationLog,
    onPublicationError,
    result,
    resultFields,
    standardResultFields,
    emitResult
  });

  const coreRoot = resolve(process.env.MEDICAL_CALENDAR_CORE_ROOT || '/opt/medical-calendar-core');
  const databasePath = process.env.MEDICAL_CALENDAR_DB_PATH;
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new Error('MEDICAL_CALENDAR_DB_PATH is required for --apply');
  }

  const boundary = verifyCoreEvidence
    ? await verifyCoreEvidence(coreRoot, coreEvidence)
    : await verifyCoreBoundary(coreRoot, coreEvidence, {
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

  const conflictVerifier = verifyConflictingPublishedVersion ?? (async ({ version, current }) => {
    throw new Error(`group ${version.groupId} already has another published version ${current.scheduleVersion.versionId}`);
  });

  const database = core.openSqliteRuntimeDatabase({ path: databasePath });
  try {
    const applied = await applySchedulePublicationPlan({
      core,
      database,
      plan,
      qaForPublication,
      verifyDatabaseState: verifyForeignKeys
        ? async ({ database: currentDatabase, phase }) => verifyForeignKeyState(currentDatabase, phase)
        : null,
      prepareDatabase: prepareDatabase
        ? async (context) => prepareDatabase({
          ...context,
          coreEvidence,
          coreBoundary: boundary
        })
        : null,
      beforePublication: beforePublication
        ? async (context) => beforePublication({
          ...context,
          coreEvidence,
          coreBoundary: boundary
        })
        : null,
      verifyConflictingPublishedVersion: conflictVerifier,
      afterPublish,
      verifyPublishedIcs: async (context) => {
        const {
          published,
          version,
          unfoldIcs,
          countVevents,
          publicationContext
        } = context;
        const calendarName = `КГМУ ${version.groupId}`;

        if (verifyPublishedIcs) {
          const verification = await verifyPublishedIcs({
            ...context,
            renderPublishedScheduleIcs: core.renderPublishedScheduleIcs,
            scheduleVersion: published.scheduleVersion,
            events: published.events,
            calendarName,
            publicationContext,
            coreBoundary: boundary
          });
          if (formatIcsVerificationLog) {
            console.log(formatIcsVerificationLog({ groupId: version.groupId, verification }));
          }
          return;
        }

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
      },
      onPublicationError: onPublicationError
        ? async (context) => onPublicationError({
          ...context,
          coreBoundary: boundary
        })
        : null
    });

    const output = {
      result,
      coreBoundary: boundary,
      groupCount: applied.groupCount,
      eventCount: applied.eventCount,
      ...resultFields,
      ...standardResultFields
    };
    if (emitResult) console.log(JSON.stringify(output, null, 2));
    return output;
  } finally {
    database.close();
  }
}
