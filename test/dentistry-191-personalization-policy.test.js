import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('dentistry optional studies are retained until personalized ICS filtering', async () => {
  const policy = await readJson('../qa/2026-2027-semester-1/dentistry-191-194.personalization-policy.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/dentistry-191.evidence.json');

  assert.equal(policy.normalizedScheduleMustRetainOptionalEvents, true);
  assert.equal(policy.filteringStage, 'personalized-ics');
  assert.equal(policy.electives.preferenceField, 'electiveChoices');
  assert.deepEqual(policy.electives.normalizedLinkage, ['selectionGroupId', 'selectionOptionId']);
  assert.equal(policy.facultatives.preferenceField, 'facultativeChoices');
  assert.deepEqual(policy.facultatives.normalizedLinkage, ['facultativeId']);

  const b49 = policy.sourceAssertions.find(item => item.locator === '1 стомат.!B49');
  assert.ok(b49);
  assert.deepEqual(b49.appliesToGroups, ['191', '192', '193', '194']);
  assert.equal(b49.groupScopeStatus, 'resolved');
  assert.equal(b49.dateScopeStatus, 'REVIEW_REQUIRED');
  assert.deepEqual(evidence.excludedSourceCells, []);
  assert.deepEqual(evidence.unresolvedSourceCells.map(item => item.locator), ['1 стомат.!B49']);
});
