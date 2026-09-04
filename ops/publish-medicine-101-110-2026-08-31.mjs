#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildMedicinePublicationPlan,
  toCorePublicationQa
} from '../src/medicine-publication-plan.js';
import {
  canonicalJson,
  digestNormalizedEvents,
  sha256Hex
} from '../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const REPLACE_EXISTING = process.argv.includes('--replace-existing');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => ![
  '--apply',
  '--preflight',
  '--replace-existing'
].includes(arg));

if (UNKNOWN_ARGS.length > 0) {
  throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);
}
if (APPLY && !REPLACE_EXISTING) {
  throw new Error('--apply requires --replace-existing for this production ScheduleVersion replacement');
}

const EXPECTED_PRODUCTION_CANDIDATE_DIGEST =
  'sha256:1d56b5b52c6eb6b7e389198309e3dee6dc3b09d6f367357c977d52b2f53755bd';
const EXPECTED_TARGET_CANDIDATE_DIGEST =
  'sha256:4834a447edd3cccf25bf1105486f34b23c64b8ab56c98db0de591e7b4da68469';
const PROTECTED_TABLES = Object.freeze([
  'calendar_subscriptions',
  'entitlements',
  'subscription_tokens',
  'calendar_preferences'
]);

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
  return `sha256:${sha256Hex(canonicalJson(sorted))}`;
}

function countVevents(ics) {
  return (ics.replace(/\r\n[ \t]/g, '').match(/BEGIN:VEVENT/g) ?? []).length;
}

function countByGroup(events) {
  const counts = {};
  for (const event of events) {
    counts[event.groupId] = (counts[event.groupId] ?? 0) + 1;
  }
  return counts;
}

function groupEvents(plan, groupId) {
  return plan.events.filter((event) => event.groupId === groupId);
}

function installProtectedWriteGuards(database) {
  const operations = ['INSERT', 'UPDATE', 'DELETE'];
  for (const table of PROTECTED_TABLES) {
    for (const operation of operations) {
      const triggerName = `medcal_guard_${table}_${operation.toLowerCase()}`;
      database.exec(`
        CREATE TEMP TRIGGER ${triggerName}
        BEFORE ${operation} ON main.${table}
        BEGIN
          SELECT RAISE(ABORT, 'protected production table mutation: ${table}');
        END
      `);
    }
  }
}

async function loadPlans() {
  const [
    targetManifest,
    targetFacultatives,
    targetSource,
    targetEvidence,
    targetQa,
    publication,
    previousManifest,
    previousFacultatives,
    previousSource,
    previousEvidence,
    previousQa
  ] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.candidate-evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.publication-evidence.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);

  if (targetQa.decision !== 'pass') {
    throw new Error('target QA decision must be pass');
  }
  if (!Array.isArray(targetQa.checks) || targetQa.checks.some((check) => check?.status === 'fail')) {
    throw new Error('target QA must contain no failing checks');
  }
  if (targetQa.sharedContractEvidence !== null) {
    throw new Error('original target QA artifact must remain immutable and pre-compatibility');
  }
  if (targetQa.compatibilityGate?.status !== 'pending') {
    throw new Error('original target QA artifact must remain pending before post-QA evidence');
  }
  if (targetQa.publicationAllowed !== false) {
    throw new Error('original target QA artifact must remain publication-blocked before post-QA evidence');
  }

  if (publication.schema !== 'kgmu-medicine-publication-evidence-v1') {
    throw new Error(`unsupported publication evidence schema: ${publication.schema}`);
  }
  if (publication.compatibilityGateEvidence?.conclusion !== 'success') {
    throw new Error('compatibility gate evidence is not successful');
  }
  if (publication.compatibilityGateEvidence?.workflowRunId !== 33918531499) {
    throw new Error('unexpected compatibility workflow run');
  }
  if (
    publication.compatibilityGateEvidence?.kgmuMainMergeCommit
    !== '2349545ed58036e9be68b57d994d82fc3c91b00b'
  ) {
    throw new Error('publication evidence is not pinned to the merged KGMU candidate');
  }

  const targetPlan = buildMedicinePublicationPlan({
    manifest: targetManifest,
    facultatives: targetFacultatives,
    source: targetSource,
    evidence: targetEvidence,
    qa: {
      ...targetQa,
      sharedContractEvidence: publication.sharedContractEvidence
    }
  });
  const previousPlan = buildMedicinePublicationPlan({
    manifest: previousManifest,
    facultatives: previousFacultatives,
    source: previousSource,
    evidence: previousEvidence,
    qa: previousQa
  });

  if (targetPlan.candidateDigest !== EXPECTED_TARGET_CANDIDATE_DIGEST) {
    throw new Error(`unexpected target candidate digest: ${targetPlan.candidateDigest}`);
  }
  if (previousPlan.candidateDigest !== EXPECTED_PRODUCTION_CANDIDATE_DIGEST) {
    throw new Error(`unexpected previous production candidate digest: ${previousPlan.candidateDigest}`);
  }
  if (publication.previousProductionCandidate?.candidateDigest !== previousPlan.candidateDigest) {
    throw new Error('publication evidence previous-production digest mismatch');
  }
  if (publication.previousProductionCandidate?.preserveAsSuperseded !== true) {
    throw new Error('publication evidence must require preserving the previous version');
  }
  if (publication.sourceSha256 !== targetPlan.sourceSha256) {
    throw new Error('publication evidence source SHA-256 mismatch');
  }
  if (publication.candidateDigest !== targetPlan.candidateDigest) {
    throw new Error('publication evidence candidate digest mismatch');
  }
  if (publication.eventSetDigest !== digestNormalizedEvents(targetPlan.events)) {
    throw new Error('publication evidence normalized event-set digest mismatch');
  }
  if (publication.eventCount !== targetPlan.events.length) {
    throw new Error('publication evidence event count mismatch');
  }

  const actualCounts = countByGroup(targetPlan.events);
  if (canonicalJson(actualCounts) !== canonicalJson(publication.groupEventCounts)) {
    throw new Error('publication evidence group event counts mismatch');
  }

  const actualFacultativeIds = [...new Set(
    targetPlan.events
      .filter((event) => event.facultativeId != null)
      .map((event) => event.facultativeId)
  )].sort();
  if (canonicalJson(actualFacultativeIds) !== canonicalJson([...publication.facultativeIds].sort())) {
    throw new Error('publication evidence facultative catalog mismatch');
  }

  for (const version of targetPlan.versions) {
    const events = groupEvents(targetPlan, version.groupId);
    const facultativeCount = events.filter((event) => event.facultativeId != null).length;
    const defaultVisibleCount = events.length - facultativeCount;
    if (publication.groupFacultativeEventCounts?.[version.groupId] !== facultativeCount) {
      throw new Error(`group ${version.groupId} facultative count mismatch`);
    }
    if (publication.groupDefaultVisibleEventCounts?.[version.groupId] !== defaultVisibleCount) {
      throw new Error(`group ${version.groupId} default-visible count mismatch`);
    }
  }

  const previousVersionByGroup = new Map(
    previousPlan.versions.map((version) => [version.groupId, version])
  );
  for (const targetVersion of targetPlan.versions) {
    const previousVersion = previousVersionByGroup.get(targetVersion.groupId);
    if (!previousVersion) {
      throw new Error(`missing previous production version for group ${targetVersion.groupId}`);
    }
    if (previousVersion.versionId === targetVersion.versionId) {
      throw new Error(`target version must differ from previous production version for group ${targetVersion.groupId}`);
    }
  }

  return {
    targetPlan,
    previousPlan,
    publication,
    qaForPublication: toCorePublicationQa(targetQa, { createdAt: publication.createdAt })
  };
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

async function verifyCurrentProduction({ repository, database, targetPlan, previousPlan }) {
  const previousVersionByGroup = new Map(
    previousPlan.versions.map((version) => [version.groupId, version])
  );
  const targetVersionByGroup = new Map(
    targetPlan.versions.map((version) => [version.groupId, version])
  );
  const state = new Map();

  for (const groupId of targetPlan.versions.map((version) => version.groupId)) {
    const previousVersion = previousVersionByGroup.get(groupId);
    const targetVersion = targetVersionByGroup.get(groupId);
    const current = await repository.getPublishedSchedule({
      universityId: targetPlan.universityId,
      groupId,
      academicYearId: targetPlan.academicYearId,
      academicPeriodId: targetPlan.academicPeriodId
    });
    if (!current) {
      throw new Error(`group ${groupId} has no current published production schedule`);
    }

    if (current.scheduleVersion.versionId === previousVersion.versionId) {
      const expected = groupEvents(previousPlan, groupId);
      if (
        current.events.length !== previousVersion.eventCount
        || eventSetDigest(current.events) !== eventSetDigest(expected)
      ) {
        throw new Error(`group ${groupId} current production events do not match expected previous candidate`);
      }
      state.set(groupId, 'previous');
      continue;
    }

    if (current.scheduleVersion.versionId === targetVersion.versionId) {
      const expected = groupEvents(targetPlan, groupId);
      if (
        current.events.length !== targetVersion.eventCount
        || eventSetDigest(current.events) !== eventSetDigest(expected)
      ) {
        throw new Error(`group ${groupId} current target events do not match approved target candidate`);
      }
      const previousRow = database
        .prepare('SELECT status FROM schedule_versions WHERE version_id = ?')
        .get(previousVersion.versionId);
      if (!previousRow || !['superseded', 'rolled_back'].includes(previousRow.status)) {
        throw new Error(`group ${groupId} target is published but previous version is not preserved`);
      }
      state.set(groupId, 'target');
      continue;
    }

    throw new Error(
      `group ${groupId} current published version ${current.scheduleVersion.versionId} is neither expected previous ${previousVersion.versionId} nor target ${targetVersion.versionId}`
    );
  }

  return state;
}

async function verifyPlanPublished({ repository, plan }) {
  const versionByGroup = new Map(plan.versions.map((version) => [version.groupId, version]));
  for (const groupId of plan.versions.map((version) => version.groupId)) {
    const expectedVersion = versionByGroup.get(groupId);
    const current = await repository.getPublishedSchedule({
      universityId: plan.universityId,
      groupId,
      academicYearId: plan.academicYearId,
      academicPeriodId: plan.academicPeriodId
    });
    const expectedEvents = groupEvents(plan, groupId);
    if (!current || current.scheduleVersion.versionId !== expectedVersion.versionId) {
      throw new Error(`group ${groupId} published baseline verification failed`);
    }
    if (
      current.events.length !== expectedVersion.eventCount
      || eventSetDigest(current.events) !== eventSetDigest(expectedEvents)
    ) {
      throw new Error(`group ${groupId} published baseline event-set verification failed`);
    }
  }
}

async function rollbackGroups({ repository, targetPlan, previousPlan, groupIds }) {
  const previousVersionByGroup = new Map(
    previousPlan.versions.map((version) => [version.groupId, version])
  );
  for (const groupId of [...groupIds].reverse()) {
    const current = await repository.getPublishedSchedule({
      universityId: targetPlan.universityId,
      groupId,
      academicYearId: targetPlan.academicYearId,
      academicPeriodId: targetPlan.academicPeriodId
    });
    const targetVersion = targetPlan.versions.find((version) => version.groupId === groupId);
    if (!current || current.scheduleVersion.versionId !== targetVersion.versionId) {
      continue;
    }
    const previousVersion = previousVersionByGroup.get(groupId);
    await repository.rollbackToVersion({ versionId: previousVersion.versionId });
    console.error(`group ${groupId}: rolled back to ${previousVersion.versionId}`);
  }
}

const { targetPlan, previousPlan, publication, qaForPublication } = await loadPlans();
const previousVersionByGroup = new Map(
  previousPlan.versions.map((version) => [version.groupId, version])
);
const transitionPlan = targetPlan.versions.map((version) => ({
  groupId: version.groupId,
  fromVersionId: previousVersionByGroup.get(version.groupId).versionId,
  toVersionId: version.versionId,
  fromEventCount: previousVersionByGroup.get(version.groupId).eventCount,
  toEventCount: version.eventCount
}));

console.log(JSON.stringify({
  mode: APPLY ? 'apply-replacement' : 'preflight',
  universityId: targetPlan.universityId,
  academicYearId: targetPlan.academicYearId,
  academicPeriodId: targetPlan.academicPeriodId,
  sourceSha256: targetPlan.sourceSha256,
  previousCandidateDigest: previousPlan.candidateDigest,
  targetCandidateDigest: targetPlan.candidateDigest,
  targetEventCount: targetPlan.events.length,
  compatibilityWorkflowRunId: publication.compatibilityGateEvidence.workflowRunId,
  transitionPlan
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

const boundary = await verifyCoreBoundary(coreRoot, targetPlan.coreEvidence);
const core = await import(pathToFileURL(resolve(coreRoot, 'src/index.js')).href);
for (const name of [
  'openSqliteRuntimeDatabase',
  'createSqliteScheduleRepository',
  'createReadyScheduleVersion',
  'renderPublishedScheduleIcs'
]) {
  if (typeof core[name] !== 'function') {
    throw new Error(`deployed core is missing ${name}`);
  }
}

const database = core.openSqliteRuntimeDatabase({ path: databasePath });
try {
  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') {
    throw new Error(`SQLite integrity_check failed: ${integrity}`);
  }

  installProtectedWriteGuards(database);
  const repository = core.createSqliteScheduleRepository(database);
  const initialState = await verifyCurrentProduction({
    repository,
    database,
    targetPlan,
    previousPlan
  });
  const targetGroupsAtStart = [...initialState.entries()]
    .filter(([, state]) => state === 'target')
    .map(([groupId]) => groupId);
  const changedGroups = [...targetGroupsAtStart];

  try {
    for (const version of targetPlan.versions) {
      const groupId = version.groupId;
      const expectedEvents = groupEvents(targetPlan, groupId);
      const expectedDigest = eventSetDigest(expectedEvents);
      const current = await repository.getPublishedSchedule({
        universityId: targetPlan.universityId,
        groupId,
        academicYearId: targetPlan.academicYearId,
        academicPeriodId: targetPlan.academicPeriodId
      });

      if (current?.scheduleVersion.versionId === version.versionId) {
        if (
          current.events.length !== version.eventCount
          || eventSetDigest(current.events) !== expectedDigest
        ) {
          throw new Error(`group ${groupId} already-published target does not match approved candidate`);
        }
        console.log(`group ${groupId}: target already published and verified`);
        continue;
      }

      const previousVersion = previousVersionByGroup.get(groupId);
      if (!current || current.scheduleVersion.versionId !== previousVersion.versionId) {
        throw new Error(`group ${groupId} changed after production preflight`);
      }

      const targetRow = database
        .prepare('SELECT status FROM schedule_versions WHERE version_id = ?')
        .get(version.versionId);
      if (targetRow && targetRow.status !== 'ready') {
        throw new Error(`group ${groupId} target version has unexpected status ${targetRow.status}`);
      }

      if (targetRow) {
        const storedRows = database
          .prepare('SELECT event_json FROM schedule_events WHERE version_id = ? ORDER BY event_id')
          .all(version.versionId);
        const storedEvents = storedRows.map((row) => JSON.parse(row.event_json));
        if (
          storedEvents.length !== version.eventCount
          || eventSetDigest(storedEvents) !== expectedDigest
        ) {
          throw new Error(`group ${groupId} ready target does not match approved candidate`);
        }
        console.log(`group ${groupId}: resuming existing verified ready target`);
      } else {
        const snapshot = core.createReadyScheduleVersion({
          parsingResult: targetPlan.parsingResult,
          qaReport: qaForPublication,
          candidateDigest: targetPlan.candidateDigest,
          groupId,
          versionId: version.versionId
        });
        await repository.saveReadySnapshot({
          academicYearId: targetPlan.academicYearId,
          scheduleVersion: snapshot.scheduleVersion,
          events: snapshot.events
        });
        console.log(`group ${groupId}: saved ready version ${version.versionId}`);
      }

      await repository.publishVersion({ versionId: version.versionId });
      changedGroups.push(groupId);
      console.log(`group ${groupId}: published ${version.versionId}`);
    }

    for (const version of targetPlan.versions) {
      const groupId = version.groupId;
      const expectedEvents = groupEvents(targetPlan, groupId);
      const published = await repository.getPublishedSchedule({
        universityId: targetPlan.universityId,
        groupId,
        academicYearId: targetPlan.academicYearId,
        academicPeriodId: targetPlan.academicPeriodId
      });
      if (!published || published.scheduleVersion.versionId !== version.versionId) {
        throw new Error(`group ${groupId} final published version verification failed`);
      }
      if (
        published.events.length !== version.eventCount
        || eventSetDigest(published.events) !== eventSetDigest(expectedEvents)
      ) {
        throw new Error(`group ${groupId} final event-set verification failed`);
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
        targetPlan.universityId,
        groupId,
        targetPlan.academicYearId,
        targetPlan.academicPeriodId
      )?.count ?? 0);
      if (publishedCount !== 1) {
        throw new Error(`group ${groupId} must have exactly one published version, got ${publishedCount}`);
      }

      const previousVersion = previousVersionByGroup.get(groupId);
      const previousRow = database
        .prepare('SELECT status FROM schedule_versions WHERE version_id = ?')
        .get(previousVersion.versionId);
      if (!previousRow || previousRow.status !== 'superseded') {
        throw new Error(`group ${groupId} previous production version is not preserved as superseded`);
      }

      const defaultIcs = core.renderPublishedScheduleIcs({
        scheduleVersion: published.scheduleVersion,
        events: published.events,
        calendarName: `КГМУ ${groupId}`
      });
      if (countVevents(defaultIcs) !== publication.groupDefaultVisibleEventCounts[groupId]) {
        throw new Error(`group ${groupId} default-off ICS VEVENT count verification failed`);
      }

      const allFacultativeChoices = Object.fromEntries(
        publication.facultativeIds.map((facultativeId) => [facultativeId, true])
      );
      const fullIcs = core.renderPublishedScheduleIcs({
        scheduleVersion: published.scheduleVersion,
        events: published.events,
        calendarName: `КГМУ ${groupId}`,
        preferences: { facultativeChoices: allFacultativeChoices }
      });
      if (countVevents(fullIcs) !== version.eventCount) {
        throw new Error(`group ${groupId} full ICS VEVENT count verification failed`);
      }
    }

    const finalIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (finalIntegrity !== 'ok') {
      throw new Error(`post-publication SQLite integrity_check failed: ${finalIntegrity}`);
    }

    console.log(JSON.stringify({
      result: 'PRODUCTION_MEDICINE_101_110_UPDATED_AND_VERIFIED',
      coreBoundary: boundary,
      previousCandidateDigest: previousPlan.candidateDigest,
      targetCandidateDigest: targetPlan.candidateDigest,
      groupCount: targetPlan.versions.length,
      eventCount: targetPlan.events.length,
      previousVersionsPreservedAsSuperseded: true,
      protectedTableWriteGuards: PROTECTED_TABLES,
      CalendarSubscriptionChanged: false,
      EntitlementChanged: false,
      SubscriptionTokenChanged: false,
      CalendarPreferencesChanged: false
    }, null, 2));
  } catch (error) {
    const rollbackSet = [...new Set(changedGroups)];
    try {
      await rollbackGroups({
        repository,
        targetPlan,
        previousPlan,
        groupIds: rollbackSet
      });
      await verifyPlanPublished({ repository, plan: previousPlan });
      const rollbackIntegrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
      if (rollbackIntegrity !== 'ok') {
        throw new Error(`post-rollback SQLite integrity_check failed: ${rollbackIntegrity}`);
      }
      console.error('ROLLBACK_TO_PREVIOUS_MEDICINE_101_110_COMPLETED');
    } catch (rollbackError) {
      console.error(
        `ROLLBACK_FAILED: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      );
    }
    throw error;
  }
} finally {
  database.close();
}
