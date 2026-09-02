import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

test('Pediatrics course 6 source is pinned and C15 normalization blocker is explicitly resolved for draft QA', async () => {
  const [source, analysis] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-631-637.source-analysis.json')
  ]);

  assert.equal(source.course, 6);
  assert.equal(source.parserProfile, 'cycle');
  assert.deepEqual(source.expectedGroupIds, ['631', '632', '633', '634', '635', '636', '637']);
  assert.equal(source.source.sha256, 'c450e454b23ba83cb273571c09fe2a1b283bec6eaa23f10e08dbf0c88ce41d60');
  assert.equal(analysis.sourceSha256, source.source.sha256);
  assert.equal(analysis.profile, 'C');
  assert.equal(analysis.calendarGrid.weekdayMismatches, 0);
  assert.equal(analysis.coverage.learningBlocks, 77);
  assert.equal(analysis.coverage.timedLearningBlocks, 70);
  assert.equal(analysis.coverage.neutralElectiveBlocks, 7);
  assert.equal(analysis.coverage.timedEventOccurrencesBeforeNormalization, 637);
  assert.equal(analysis.coverage.neutralElectiveDateOccurrences, 42);
  assert.equal(analysis.coverage.expectedCompleteEventOccurrences, 679);
  assert.equal(analysis.ruleApplications.C02.starredCycles, 9);
  assert.equal(analysis.ruleApplications.C02.allStarredCyclesHaveExplicitSecondShift, true);
  assert.equal(analysis.ruleApplications.C15.requiredRepresentation, 'date-only/all-day');
  assert.equal(analysis.ruleApplications.C15.commonExactTimeAvailable, false);

  assert.equal(analysis.contractBlockers.length, 1);
  const blocker = analysis.contractBlockers[0];
  assert.equal(blocker.id, 'PED6-C15-DATE-ONLY-NORMALIZED-EVENT');
  assert.equal(blocker.profileOnlyResolutionPossible, false);
  assert.equal(blocker.normalizedDraftResolution.pullRequest, 245);
  assert.equal(blocker.normalizedDraftResolution.headCommit, '8d54784d8407ccc1fc817aa060039bc783f41fdf');
  assert.equal(blocker.normalizedDraftResolution.coreCiConclusion, 'success');
  assert.equal(blocker.normalizedDraftBlocked, false);
  assert.equal(blocker.publicationBlocked, true);

  assert.equal(analysis.normalizationStatus, 'COMPLETE_CANDIDATE_AVAILABLE_WITH_DRAFT_CORE_DEPENDENCY');
  assert.equal(analysis.qaStatus, 'ELIGIBLE_FOR_NORMALIZED_DRAFT_PASS');
  assert.equal(analysis.publicationPerformed, false);
});
