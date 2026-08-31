import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function loadStream(stream) {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson(`../fixtures/2026-2027-semester-1/medicine-${stream}.decisions.json`),
    readJson(`../fixtures/2026-2027-semester-1/medicine-${stream}.source.json`),
    readJson(`../qa/2026-2027-semester-1/medicine-${stream}.evidence.json`),
    readJson(`../qa/2026-2027-semester-1/medicine-${stream}.qa-report.json`)
  ]);
  return { manifest, source, evidence, qa, plan: buildExplicitPublicationPlan({ manifest, source, evidence, qa }) };
}

function assertUniqueEventIds(events) {
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
}

function optionIds(events) {
  return [...new Set(events.filter((event) => event.selection).map((event) => event.selection.selectionOptionId))].sort();
}

const EXPECTED_OPTIONS = [
  'biochemical-healthy-lifestyle',
  'dietology',
  'functional-diagnostics',
  'intercultural-professional-communication',
  'latin-pharmaceutical-terminology',
  'molecular-pathology',
  'statistical-evidence-medicine'
];

test('medicine 301-310 publication plan matches approved digest and preserves group-310 operator decision', async () => {
  const { manifest, evidence, qa, plan } = await loadStream('301-310');

  assert.equal(manifest.candidateDigest, 'sha256:72e6c0c5d15c8af893b4f97d8f4c0d1285beeb3ff8b62bb877367e50694d51ba');
  assert.equal(evidence.baseCandidateDigest, manifest.candidateDigest);
  assert.equal(plan.candidateDigest, 'sha256:c7bd7970bacbfbcfc703499ae7951c90a906674ce62def88167e70f468998bf1');
  assert.equal(qa.decision, 'pass');
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(plan.events.length, 3651);
  assert.deepEqual(Object.fromEntries(plan.versions.map((version) => [version.groupId, version.eventCount])), {
    '301': 364, '302': 364, '303': 368, '304': 368, '305': 368,
    '306': 368, '307': 368, '308': 367, '309': 365, '310': 351
  });
  assertUniqueEventIds(plan.events);
  assert.deepEqual(optionIds(plan.events), EXPECTED_OPTIONS);
  assert.ok(plan.events.filter((event) => event.selection).every((event) => event.selection.selectionGroupId === 'medicine-3-choice-discipline-2026-s1'));

  const operator = plan.events.filter((event) =>
    event.groupId === '310' &&
    event.date === '2026-12-30' &&
    event.startTime === '08:00' &&
    event.endTime === '10:25' &&
    event.discipline === 'Молекулярные механизмы в патологии человека'
  );
  assert.equal(operator.length, 1);
  assert.equal(operator[0].sourceRef.locator, '3 леч.1!B18#operator-g310');
  assert.deepEqual(operator[0].selection, {
    selectionGroupId: 'medicine-3-choice-discipline-2026-s1',
    selectionOptionId: 'molecular-pathology'
  });
  assert.equal(plan.events.some((event) => event.groupId === '310' && event.sourceRef.locator === '3 леч.1!B18#s1'), false);

  assert.equal(plan.events.some((event) =>
    event.groupId === '308' && event.date === '2026-12-23' &&
    event.discipline === 'Элективные дисциплины по физической культуре и спорту' &&
    event.sourceRef.locator === '3 леч.1!B18#s2'
  ), false);
  assert.ok(qa.checks.some((check) => check.code === 'explicit-overlaps-preserved' && check.status === 'warning'));
});

test('medicine 311-317 publication plan matches approved digest, selections and date-scoped online events', async () => {
  const { evidence, qa, plan } = await loadStream('311-317');

  assert.equal(plan.candidateDigest, 'sha256:347bbe20f2516b5e734788ae8cfb8d1fd3153e35ee8cf3eedb928bd340787ada');
  assert.equal(qa.decision, 'pass');
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(plan.events.length, 2438);
  assert.deepEqual(Object.fromEntries(plan.versions.map((version) => [version.groupId, version.eventCount])), {
    '311': 349, '312': 349, '313': 347, '314': 348, '315': 348, '316': 348, '317': 349
  });
  assertUniqueEventIds(plan.events);
  assert.deepEqual(optionIds(plan.events), EXPECTED_OPTIONS);
  assert.ok(plan.events.filter((event) => event.selection).every((event) => event.selection.selectionGroupId === 'medicine-3-choice-discipline-2026-s1'));

  for (const expected of evidence.onlineEvents) {
    const event = plan.events.find((candidate) =>
      candidate.date === expected.date &&
      candidate.discipline === expected.discipline &&
      candidate.sourceRef.locator === expected.sourceLocator
    );
    assert.ok(event, `missing online event ${expected.sourceLocator} ${expected.date}`);
    assert.equal(event.location, 'Онлайн');
  }

  for (const suppressed of evidence.r66SuppressedComputedOccurrences) {
    const fullLocator = `3 леч.2!${suppressed.locator}`;
    assert.equal(plan.events.some((event) =>
      event.groupId === suppressed.groupId &&
      event.date === suppressed.date &&
      event.discipline === suppressed.discipline &&
      event.sourceRef.locator === fullLocator
    ), false, `R66 event still present: ${suppressed.groupId} ${suppressed.date} ${suppressed.locator}`);
  }
});
