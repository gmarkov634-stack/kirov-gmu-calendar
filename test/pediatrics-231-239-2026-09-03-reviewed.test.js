import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const mins = (value) => {
  const [h,m] = value.split(':').map(Number);
  return h * 60 + m;
};
const overlaps = (a,b) => mins(a.startTime) < mins(b.endTime) && mins(b.startTime) < mins(a.endTime);

test('current pediatrics 231-239 source is freshly reviewed and platform-compatible', async () => {
  const [manifest, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239-2026-09-03.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239-2026-09-03.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239-2026-09-03.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239-2026-09-03.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239-2026-09-03.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239-2026-09-03.source-change-full-diff.json'),
  ]);

  assert.equal(source.source.sha256, 'eff3de3dbf59f9612f45165db70737c7b510ea3dcf063ac95f6319a8f3b23a69');
  assert.equal(source.source.byteLength, 18263);
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-compatible');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, true);
  assert.equal(semantic.semanticPublicationGate, 'PASS');
  assert.equal(semantic.platformPublicationGate, 'PASS');
  assert.deepEqual(semantic.unresolvedAmbiguities, []);
  assert.equal(evidence.platformCompatibility.status, 'pass');
  assert.equal(evidence.platformCompatibility.commit, '23c6a686df2204b6d942dfe9187b318f0d268a88');
  assert.equal(qa.compatibilityGate.status, 'pass');
  assert.equal(qa.compatibilityGate.platformCommit, '23c6a686df2204b6d942dfe9187b318f0d268a88');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);

  assert.deepEqual(diff.normalizedSemanticDiff.changedCells, [{
    coord: 'J26',
    old: '12.10-13.40 Философия 03.09-24.12 1-323',
    new: '12.05-13.35 Философия 03.09-24.12 1-323',
  }]);
  assert.deepEqual(diff.normalizedSemanticDiff.addedCells, []);
  assert.deepEqual(diff.normalizedSemanticDiff.removedCells, []);
  assert.deepEqual(diff.mergedRangeDiff, { added: [], removed: [] });
  assert.equal(diff.semanticDecisionReuseAllowed, false);

  assert.deepEqual(
    manifest.decisions.filter((tuple) => tuple[0] === 'J26#s1'),
    [['J26#s1','100','4104104104104104104104104','12:05','13:35',0,1,14]],
  );

  const plan = buildExplicitPublicationPlan({ manifest, source, evidence, qa });
  assert.equal(plan.events.length, 2353);
  assert.equal(plan.candidateDigest, 'sha256:d3a12214e4aeea6c6a019d4c7b114661a04ae4f49508766f1a9a677397acc6a0');
  assert.deepEqual(Object.fromEntries(plan.versions.map((v) => [v.groupId, v.eventCount])), {
    '231':261,'232':262,'233':262,'234':261,'235':261,
    '236':262,'237':262,'238':262,'239':260,
  });

  const j26 = plan.events.filter((event) => event.sourceRef.locator === '2пед.!J26#s1');
  assert.equal(j26.length, 17);
  assert.ok(j26.every((event) =>
    event.groupId === '239' &&
    event.discipline === 'Философия' &&
    event.startTime === '12:05' &&
    event.endTime === '13:35'
  ));
  assert.equal(j26[0].date, '2026-09-03');
  assert.equal(j26.at(-1).date, '2026-12-24');

  const d11 = plan.events.filter((event) =>
    event.groupId === '233' &&
    event.date === '2026-12-08' &&
    event.sourceRef.locator === '2пед.!D11#s2'
  );
  assert.equal(d11.length, 1);
  assert.equal(d11[0].discipline, 'Биохимия');
  assert.equal(d11[0].startTime, '09:30');
  assert.equal(d11[0].endTime, '10:15');

  const g18 = plan.events.filter((event) => event.sourceRef.locator === '2пед.!G18#s1');
  const j18 = plan.events.filter((event) => event.sourceRef.locator === '2пед.!J18#s1');
  const d26 = plan.events.filter((event) => event.sourceRef.locator === '2пед.!D26#s1');
  assert.ok(g18.every((event) => event.startTime === '08:00' && event.endTime === '10:25'));
  assert.ok(j18.every((event) => event.startTime === '08:00' && event.endTime === '10:25'));
  assert.ok(d26.every((event) => event.startTime === '15:35' && event.endTime === '18:00'));

  const signatures = new Set();
  for (const event of plan.events) {
    const signature = [
      event.groupId,event.date,event.startTime,event.endTime,
      event.discipline,event.lessonType,event.location ?? '',
    ].join('|');
    assert.equal(signatures.has(signature), false);
    signatures.add(signature);
  }

  const byDay = new Map();
  for (const event of plan.events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let overlapCount = 0;
  for (const list of byDay.values()) {
    for (let i=0;i<list.length;i+=1) for (let j=i+1;j<list.length;j+=1) {
      if (overlaps(list[i],list[j])) overlapCount += 1;
    }
  }
  assert.equal(overlapCount, 3);
});