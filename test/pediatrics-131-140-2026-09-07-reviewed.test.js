import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildPediatricsPublicationPlan } from '../src/pediatrics-publication-plan.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const mins = (value) => {
  const [h,m] = value.split(':').map(Number);
  return h * 60 + m;
};
const overlaps = (a,b) => mins(a.startTime) < mins(b.endTime) && mins(b.startTime) < mins(a.endTime);

test('current pediatrics 131-140 source is freshly reviewed and platform-compatible', async () => {
  const [manifest, facultatives, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140-2026-09-07.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140-2026-09-07.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140-2026-09-07.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140-2026-09-07.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140-2026-09-07.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140-2026-09-07.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140-2026-09-07.source-change-full-diff.json'),
  ]);

  assert.equal(source.source.sha256, 'b0840a7ff48ebb84ee37b9a390450c1f18ef46270ca5b588899f89c37e1268bd');
  assert.equal(source.source.byteLength, 20870);
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-compatible');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, true);
  assert.equal(semantic.semanticPublicationGate, 'PASS');
  assert.equal(semantic.platformPublicationGate, 'PASS');
  assert.deepEqual(semantic.unresolvedAmbiguities, []);
  assert.equal(evidence.platformCompatibility.status, 'pass');
  assert.equal(evidence.platformCompatibility.commit, '0a3539e9a76c2902e1fe114864b921854a9c020a');
  assert.equal(qa.compatibilityGate.status, 'pass');
  assert.equal(qa.compatibilityGate.platformCommit, '0a3539e9a76c2902e1fe114864b921854a9c020a');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(facultatives.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(manifest.logicalSourceCellCount, 128);
  assert.equal(evidence.coveredSourceCellCount, 128);

  assert.deepEqual(diff.normalizedSemanticDiff, {
    changedCells: ['D36','D38','K27','K45'],
    addedCells: ['K39'],
    removedCells: [],
    lowerReferenceTableChanges: [],
  });
  assert.deepEqual(diff.mergedRangeDiff, {
    removed: ['J46:K46'],
    added: ['K45:K46'],
  });
  assert.equal(diff.structuralReview.semanticDecisionReuseAllowed, false);

  const tuple = (locator) => manifest.decisions.filter((item) => item[0] === locator);
  assert.deepEqual(tuple('D36#s1'), [['D36#s1','4','1008208208208208208208208208','08:00','10:25',4,3,1]]);
  assert.deepEqual(tuple('D38#s1'), [['D38#s1','4','8208208','11:35','14:45',7,3,8]]);
  assert.deepEqual(tuple('D38#s2'), [['D38#s2','4','8208200000000','11:35','14:45',7,3,9]]);
  assert.deepEqual(tuple('K27#s1'), [['K27#s1','200','482082082082082082082082082','13:40','16:05',4,3,1]]);
  assert.deepEqual(tuple('K39#s1'), [['K39#s1','200','208','15:40','16:40',11,2,11]]);
  assert.deepEqual(tuple('K45#s1'), [['K45#s1','200','2000000000000000000000000000','16:40','19:05',12,0,21]]);
  assert.equal(tuple('J46#s1').length, 0);

  const plan = buildPediatricsPublicationPlan({ manifest, facultatives, source, evidence, qa });
  assert.equal(plan.events.length, 3820);
  assert.equal(plan.candidateDigest, 'sha256:05b8562e0ee15ffc73cf68b6ac0e9fbb68aa6faf3d55e1fac8f2f9b743401351');
  assert.equal(evidence.baseCandidateDigest, 'sha256:f8076ac51ea994a8d6a46df1e584dff244ccb84d5238012179d6e54f1963f703');
  assert.deepEqual(Object.fromEntries(plan.versions.map((v) => [v.groupId, v.eventCount])), {
    '131':381,'132':382,'133':382,'134':383,'135':382,
    '136':383,'137':381,'138':381,'139':383,'140':382,
  });

  const byLocator = (locator) => plan.events.filter((event) => event.sourceRef.locator === `1 пед. 10 гр.!${locator}`);
  assert.equal(byLocator('D36#s1').length, 18);
  assert.ok(byLocator('D36#s1').every((event) =>
    event.groupId === '133' &&
    event.discipline === 'Общая и биоорганическая химия' &&
    event.startTime === '08:00' && event.endTime === '10:25'
  ));
  assert.equal(byLocator('D38#s1').length, 5);
  assert.equal(byLocator('D38#s2').length, 4);
  assert.ok([...byLocator('D38#s1'), ...byLocator('D38#s2')].every((event) =>
    event.groupId === '133' &&
    event.discipline.startsWith('Учебная практика.') &&
    event.startTime === '11:35' && event.endTime === '14:45'
  ));

  const k27 = byLocator('K27#s1');
  assert.equal(k27.length, 19);
  assert.equal(k27[0].date, '2026-09-02');
  assert.equal(k27.at(-1).date, '2027-01-13');
  assert.ok(k27.every((event) => event.groupId === '140' && event.discipline === 'Общая и биоорганическая химия'));

  assert.deepEqual(byLocator('K39#s1').map((event) => event.date), ['2026-09-04','2026-09-11']);
  assert.ok(byLocator('K39#s1').every((event) =>
    event.groupId === '140' &&
    event.discipline === 'Час куратора' &&
    event.startTime === '15:40' && event.endTime === '16:40'
  ));

  const k45 = byLocator('K45#s1');
  assert.equal(k45.length, 1);
  assert.equal(k45[0].groupId, '140');
  assert.equal(k45[0].date, '2027-01-16');
  assert.equal(k45[0].discipline, 'Основы российской государственности');
  assert.equal(k45[0].assessment?.type, 'graded-credit');
  assert.equal(byLocator('J46#s1').length, 0);

  const k16 = plan.events.filter((event) =>
    event.groupId === '140' &&
    event.date === '2026-12-15' &&
    event.startTime === '11:00' &&
    event.endTime === '14:10' &&
    event.sourceRef.locator === '1 пед. 10 гр.!K16#s3'
  );
  assert.equal(k16.length, 1);
  assert.match(k16[0].location, /КОДКБ/);

  const facultativeEvents = plan.events.filter((event) => event.facultativeId);
  assert.equal(facultativeEvents.length, 920);
  assert.equal(facultatives.defaultSelected, false);
  assert.equal(new Set(facultativeEvents.map((event) => event.facultativeId)).size, 5);

  const signatures = new Set();
  for (const event of plan.events) {
    const signature = [
      event.groupId,event.date,event.startTime,event.endTime,
      event.discipline,event.lessonType,event.location ?? '',event.facultativeId ?? '',
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
  const pairs = [];
  for (const list of byDay.values()) {
    for (let i=0;i<list.length;i+=1) for (let j=i+1;j<list.length;j+=1) {
      if (overlaps(list[i],list[j])) pairs.push([list[i],list[j]]);
    }
  }
  assert.equal(pairs.length, 158);
  assert.equal(pairs.filter(([a,b]) => !a.facultativeId && !b.facultativeId).length, 2);
  assert.equal(pairs.filter(([a,b]) => a.facultativeId || b.facultativeId).length, 156);
});