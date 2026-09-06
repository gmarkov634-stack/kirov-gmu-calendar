import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Pediatrics, Dentistry and Medicine share only the generic apply lifecycle', async () => {
  const [generic, pediatrics, dentistry, medicine] = await Promise.all([
    source('ops/lib/apply-schedule-publication-plan.mjs'),
    source('ops/lib/publish-pediatrics-course.mjs'),
    source('ops/lib/publish-dentistry-course.mjs'),
    source('ops/lib/publish-medicine-plan.mjs')
  ]);

  for (const adapter of [pediatrics, dentistry, medicine]) {
    assert.match(adapter, /applySchedulePublicationPlan/);
    assert.doesNotMatch(adapter, /saveReadySnapshot/);
    assert.doesNotMatch(adapter, /publishVersion\(/);
    assert.doesNotMatch(adapter, /SELECT COUNT\(\*\) AS count FROM schedule_versions/);
  }

  for (const invariant of [
    'PRAGMA integrity_check',
    'createSqliteScheduleRepository',
    'createReadyScheduleVersion',
    'saveReadySnapshot',
    'publishVersion',
    'published target does not match the approved candidate',
    'ready target does not match the approved candidate',
    'final published version verification failed',
    'final event-set verification failed',
    'must have exactly one published version',
    'verifyDatabaseState',
    'prepareDatabase',
    'beforePublication',
    'verifyConflictingPublishedVersion',
    'afterPublish',
    'verifyPublishedIcs',
    'onPublicationError'
  ]) {
    assert.match(generic, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.doesNotMatch(generic, /programId\s*!==/);
  assert.doesNotMatch(generic, /pediatrics|dentistry|medicine/i);
  assert.doesNotMatch(generic, /DELETE\s+FROM\s+schedule_versions/i);
  assert.doesNotMatch(generic, /rollbackToVersion|replace-existing/i);
});

test('program-specific production and ICS boundaries remain in their adapters', async () => {
  const [pediatrics, dentistry, medicine] = await Promise.all([
    source('ops/lib/publish-pediatrics-course.mjs'),
    source('ops/lib/publish-dentistry-course.mjs'),
    source('ops/lib/publish-medicine-plan.mjs')
  ]);

  assert.match(pediatrics, /programId !== 'pediatrics'/);
  assert.match(pediatrics, /requireProductionRuntimeCommit/);
  assert.match(pediatrics, /includeApprovedMainCommit/);
  assert.match(pediatrics, /КГМУ педиатрия/);
  assert.match(pediatrics, /oldScheduleVersionRowsPreserved: true/);

  assert.match(dentistry, /programId !== 'dentistry'/);
  assert.match(dentistry, /\.deployed-commit/);
  assert.match(dentistry, /groupDefaultVisibleEventCounts/);
  assert.match(dentistry, /facultativeChoices/);
  assert.match(dentistry, /КГМУ стоматология/);
  assert.match(dentistry, /subscriptionTokensChanged: false/);
  assert.match(dentistry, /calendarPreferencesChanged: false/);

  assert.match(medicine, /plan\.universityId !== 'kirov-gmu'/);
  assert.match(medicine, /verifyCoreBoundary/);
  assert.match(medicine, /compatibleRendererBlobs/);
  assert.match(medicine, /reportRendererCompatibility/);
  assert.match(medicine, /verifyForeignKeyState/);
  assert.match(medicine, /КГМУ \$\{version\.groupId\}/);
  assert.match(medicine, /trialChanged: false/);
  assert.match(medicine, /checkoutChanged: false/);
});
