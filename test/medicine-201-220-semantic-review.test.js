import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function review() {
  return JSON.parse(await readFile(
    new URL('../qa/2026-2027-semester-1/medicine-201-220.semantic-review.json', import.meta.url),
    'utf8'
  ));
}

test('medicine 201-220 review remains source-bound and fail-closed on group 206 Anatomy', async () => {
  const value = await review();
  assert.equal(value.schema, 'kgmu-semantic-source-review-v1');
  assert.equal(value.sourceProbe.workflowRunId, 33326354544);
  assert.equal(value.sourceProbe.artifactDigest, 'sha256:6ffd1d850b9703e3925ca78fa3a2eeb6fd48696f3625f3f2fdda6ace73cb754a');

  const first = value.streams[0];
  assert.equal(first.sourceSha256, '1f606b90433347211546d9caa55ff42e4462c3f81f9d78ad7508c5c290dae7c3');
  assert.equal(first.status, 'REVIEW_REQUIRED');
  assert.equal(first.additionalLessonExpectations, 39);
  assert.equal(first.matchedAdditionalLessonExpectations, 38);
  assert.equal(first.reviewItems.length, 1);
  assert.equal(first.reviewItems[0].group, '206');
  assert.equal(first.reviewItems[0].mainLocator, 'G23');
  assert.equal(first.reviewItems[0].nearbyExplicitLocator, 'G28');
  assert.equal(first.reviewItems[0].nearbyExplicitAnatomy.date, '2026-12-30');
  assert.equal(first.reviewItems[0].nearbyExplicitAnatomy.startTime, '13:30');
  assert.equal(first.reviewItems[0].nearbyExplicitAnatomy.endTime, '15:55');
  assert.equal(new Date('2026-12-30T00:00:00Z').getUTCDay(), 3); // Wednesday
  assert.equal(first.reviewItems[0].automaticResolution, false);
  assert.equal(first.reviewItems[0].dateSynthesisAllowed, false);

  const second = value.streams[1];
  assert.equal(second.sourceSha256, 'dcac53458b56d0b2c2c5d7657bd39d09fe28233567ce6e51551f87483d71c4ca');
  assert.equal(second.status, 'SEMANTIC_QA_PASS');
  assert.equal(second.additionalLessonExpectations, 45);
  assert.equal(second.matchedAdditionalLessonExpectations, 45);
  assert.equal(second.unresolvedAmbiguities, 0);

  assert.equal(value.aggregate.safeDraftEvents, 5310);
  assert.equal(value.aggregate.additionalLessonExpectations, 84);
  assert.equal(value.aggregate.matchedAdditionalLessonExpectations, 83);
  assert.equal(value.aggregate.unresolvedAmbiguities, 1);
  assert.equal(value.aggregate.duplicateNormalizedEventSignatures, 0);
  assert.equal(value.aggregate.publicationPerformed, false);
  assert.equal(value.aggregate.publicationAllowed, false);
});
