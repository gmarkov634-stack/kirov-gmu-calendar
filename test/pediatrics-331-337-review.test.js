import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

function countByGroup(events) {
  return Object.fromEntries(
    [...events.reduce((counts, event) => {
      counts.set(event.groupId, (counts.get(event.groupId) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([a], [b]) => Number(a) - Number(b))
  );
}

test('Pediatrics course 3 candidate is source-complete and QA-passing', async () => {
  const [source, manifest, evidence, plan, crossDay, review, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.source.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.decisions.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.date-plan.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.cross-day-audit.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.qa-report.json')
  ]);

  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(plan.sourceSha256, source.source.sha256);
  assert.equal(review.sourceSha256, source.source.sha256);
  assert.equal(qa.sourceSha256, source.source.sha256);
  assert.deepEqual(manifest.groupTable, ['331', '332', '333', '334', '335', '336', '337']);

  assert.equal(plan.sourceCellCount, 98);
  assert.equal(plan.sourceSegmentCount, 131);
  assert.equal(plan.plannedSegmentCount, 131);
  assert.equal(plan.reviewRequiredCellCount, 0);
  assert.equal(manifest.logicalSourceCellCount, 131);
  assert.equal(manifest.decisionCount, 144);

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const digest = digestNormalizedEvents(events);
  assert.equal(events.length, 1781);
  assert.equal(digest, 'sha256:19fcc970c203a672a4d2da12eb3e4791b48312c3c3d2d84943dc7ffd6b3129dc');
  assert.equal(digest, manifest.candidateDigest);
  assert.equal(digest, evidence.candidateDigest);
  assert.equal(digest, qa.candidateDigest);
  assert.deepEqual(countByGroup(events), {
    '331': 254,
    '332': 254,
    '333': 253,
    '334': 254,
    '335': 255,
    '336': 255,
    '337': 256
  });

  assert.equal(crossDay.cueCount, 44);
  assert.equal(crossDay.passCount, 43);
  assert.equal(crossDay.reviewRequiredCount, 1);
  assert.equal(review.status, 'PASS');
  assert.equal(review.blocksPublication, false);
  assert.equal(review.unresolvedAmbiguities.length, 0);
  assert.equal(review.resolvedAmbiguities.length, 1);
  assert.equal(review.resolvedAmbiguities[0].confirmationId, 'USER-2026-09-02-PED3-KEEP-07-12');

  assert.equal(qa.decision, 'pass');
  assert.deepEqual(qa.blockingIssues, []);
  assert.equal(qa.checks.sourceCells.expected, 98);
  assert.equal(qa.checks.sourceCells.covered, 98);
  assert.equal(qa.checks.sourceSegments.expected, 131);
  assert.equal(qa.checks.sourceSegments.covered, 131);
  assert.equal(qa.checks.normalizedEvents.invalidCount, 0);
  assert.equal(qa.checks.exactLogicalDuplicates.count, 0);
  assert.equal(qa.checks.overlaps.count, 4);
  assert.equal(qa.checks.overlaps.blocking, false);
  assert.equal(qa.checks.locationSafety.suspiciousSourceAddressPropagatedCount, 0);

  const resolution = qa.checks.group333MicrobiologyResolution;
  assert.equal(resolution.confirmationId, 'USER-2026-09-02-PED3-KEEP-07-12');
  assert.deepEqual(resolution.mondayEvents, [{
    date: '2026-12-07',
    sourceLocator: '3пед.!D12#s2',
    startTime: '15:40',
    endTime: '18:05'
  }]);
  assert.equal(resolution.resolvedExplicitCount, 1);
  assert.equal(resolution.d20SyntheticCount, 0);

  assert.equal(qa.publicationGate.candidateQaPass, true);
  assert.equal(qa.publicationGate.productionPublished, false);
  assert.equal(qa.publicationGate.landingExposed, false);
});
