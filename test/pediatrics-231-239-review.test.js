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

test('Pediatrics course 2 provisional manifest is internally exact but publication-blocked', async () => {
  const [source, manifest, evidence, review, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239.source.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239.decisions.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239.qa-report.json')
  ]);

  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(review.sourceSha256, source.source.sha256);
  assert.deepEqual(manifest.groupTable, source.expectedGroupIds);
  assert.equal(manifest.logicalSourceCellCount, 114);
  assert.equal(manifest.decisionCount, 158);

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const digest = digestNormalizedEvents(events);
  assert.equal(events.length, evidence.eventCount);
  assert.equal(digest, manifest.candidateDigest);
  assert.equal(digest, evidence.candidateDigest);
  assert.equal(digest, qa.candidateDigest);
  assert.deepEqual(countByGroup(events), evidence.groupEventCounts);

  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.blocksPublication, true);
  assert.equal(review.unresolvedAmbiguities.length, 1);
  assert.equal(review.unresolvedAmbiguities[0].ambiguityId, 'PED2-D33-D11-BIOCHEM-EXTRA-MONDAY');
  assert.equal(qa.decision, 'review_required');
  assert.ok(qa.checks.some((check) => check.code === 'semantic-review-gate' && check.status === 'fail'));
});
