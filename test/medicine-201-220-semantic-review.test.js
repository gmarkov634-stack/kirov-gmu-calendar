import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function review() {
  return JSON.parse(await readFile(
    new URL('../qa/2026-2027-semester-1/medicine-201-220.semantic-review.json', import.meta.url),
    'utf8'
  ));
}

test('medicine 201-220 semantic review is source-bound and fully resolved', async () => {
  const value = await review();
  assert.equal(value.schema, 'kgmu-semantic-source-review-v1');
  assert.equal(value.parserRulesVersion, 'kgmu-2026-08-30-v4');
  assert.equal(value.sourceProbe.workflowRunId, 33326354544);
  assert.equal(value.sourceProbe.artifactDigest, 'sha256:6ffd1d850b9703e3925ca78fa3a2eeb6fd48696f3625f3f2fdda6ace73cb754a');

  const first = value.streams[0];
  assert.equal(first.sourceSha256, '1f606b90433347211546d9caa55ff42e4462c3f81f9d78ad7508c5c290dae7c3');
  assert.equal(first.status, 'SEMANTIC_QA_PASS');
  assert.equal(first.normalizedEvents, 2662);
  assert.equal(first.matchedAdditionalLessonExpectations, first.additionalLessonExpectations);
  assert.equal(first.unresolvedAmbiguities, 0);
  assert.equal(first.operatorConfirmations.length, 1);
  assert.equal(first.operatorConfirmations[0].group, '206');
  assert.equal(first.operatorConfirmations[0].mainLocator, 'G23');
  assert.equal(first.operatorConfirmations[0].relatedExplicitLocator, 'G28');
  assert.equal(first.operatorConfirmations[0].relatedExplicitDate, '2026-12-30');
  assert.equal(first.operatorConfirmations[0].operatorExtraDate, '2026-12-31');
  assert.equal(new Date('2026-12-31T00:00:00Z').getUTCDay(), 4); // Thursday
  assert.equal(first.operatorConfirmations[0].rules.includes('R91'), false);
  assert.match(first.operatorConfirmations[0].decision, /31\.12\.2026/);

  const second = value.streams[1];
  assert.equal(second.sourceSha256, 'dcac53458b56d0b2c2c5d7657bd39d09fe28233567ce6e51551f87483d71c4ca');
  assert.equal(second.status, 'SEMANTIC_QA_PASS');
  assert.equal(second.normalizedEvents, 2646);
  assert.equal(second.matchedAdditionalLessonExpectations, second.additionalLessonExpectations);
  assert.equal(second.unresolvedAmbiguities, 0);

  assert.equal(value.aggregate.normalizedEvents, 5308);
  assert.equal(value.aggregate.matchedAdditionalLessonExpectations, 84);
  assert.equal(value.aggregate.unresolvedAmbiguities, 0);
  assert.equal(value.aggregate.semanticPublicationGate, 'PASS');
  assert.equal(value.aggregate.publicationPerformed, false);
});
