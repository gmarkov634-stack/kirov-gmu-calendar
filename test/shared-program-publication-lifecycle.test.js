import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Pediatrics and Dentistry share only the strict apply lifecycle', async () => {
  const [generic, pediatrics, dentistry] = await Promise.all([
    source('ops/lib/apply-schedule-publication-plan.mjs'),
    source('ops/lib/publish-pediatrics-course.mjs'),
    source('ops/lib/publish-dentistry-course.mjs')
  ]);

  for (const adapter of [pediatrics, dentistry]) {
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
    'verifyPublishedIcs'
  ]) {
    assert.match(generic, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.doesNotMatch(generic, /programId\s*!==/);
  assert.doesNotMatch(generic, /pediatrics|dentistry/i);
  assert.doesNotMatch(generic, /DELETE\s+FROM\s+schedule_versions/i);
});

test('program-specific production and ICS boundaries remain in their adapters', async () => {
  const [pediatrics, dentistry] = await Promise.all([
    source('ops/lib/publish-pediatrics-course.mjs'),
    source('ops/lib/publish-dentistry-course.mjs')
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
});
