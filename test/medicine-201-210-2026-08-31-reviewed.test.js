import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

test('current medicine 201-210 source is semantically reviewed but platform-gated', async () => {
  const [manifest, source, review, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-201-210-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-201-210-2026-08-31.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-201-210-2026-08-31.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-201-210-2026-08-31.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-201-210-2026-08-31.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-201-210-2026-08-31.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-201-210-2026-08-31.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, '8845fd50d4eb534eac81cc84a12dbf5c4f4f2001ef190f5d6ffd3dd2b7d70551');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(semantic.sourceSha256, source.source.sha256);
  assert.equal(source.parserRulesVersion, 'kgmu-2026-10-01-v5');
  assert.equal(manifest.parserRulesVersion, source.parserRulesVersion);
  assert.equal(evidence.parserRulesVersion, source.parserRulesVersion);
  assert.equal(semantic.parserRulesVersion, source.parserRulesVersion);
  assert.equal(semantic.stream.unresolvedAmbiguities, 0);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, false);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(qa.compatibilityGate.status, 'pending');

  const b8 = manifest.decisions.filter((tuple) => tuple[0] === 'B8#s1');
  assert.deepEqual(b8, [['B8#s1','3ff','800000800000800','11:00','12:30',11,0,7]]);
  const b36 = manifest.decisions.filter((tuple) => tuple[0] === 'B36#s1');
  assert.deepEqual(b36, [['B36#s1','3ff','10010010010010010010010010','08:30','10:00',4,0,12]]);

  const plan = buildExplicitPublicationPlan({ manifest, source, evidence, qa });
  assert.equal(plan.events.length, 2652);
  assert.equal(plan.candidateDigest, 'sha256:06f58bf7c6a39c8b890a99073de8b6573d36da9ccf9f56f63eeb394a8f816b17');

  const ecology = plan.events.filter((event) => event.sourceRef.locator === '2 леч.1!B8#s1');
  assert.equal(ecology.length, 30);
  assert.deepEqual([...new Set(ecology.map((event) => event.date))], [
    '2026-09-14','2026-10-12','2026-11-09',
  ]);
  assert.equal(ecology.some((event) => event.date === '2026-12-07'), false);

  const immunology = plan.events.filter((event) => event.sourceRef.locator === '2 леч.1!B36#s1');
  assert.equal(immunology.length, 90);
  assert.ok(immunology.every((event) => event.startTime === '08:30' && event.endTime === '10:00'));

  assert.equal(
    plan.events.some((event) =>
      event.groupId === '201'
      && event.date === '2026-12-18'
      && event.sourceRef.locator === '2 леч.1!B34#s1'
    ),
    false,
  );

  const extra = plan.events.filter((event) =>
    event.sourceRef.locator === '2 леч.1!G23#operator-extra-2026-12-31'
  );
  assert.equal(extra.length, 1);
  assert.equal(extra[0].groupId, '206');
  assert.equal(extra[0].date, '2026-12-31');
  assert.equal(extra[0].startTime, '13:10');
  assert.equal(extra[0].endTime, '15:35');

  const counts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    plan.events.filter((event) => event.groupId === groupId).length,
  ]));
  assert.deepEqual(counts, evidence.groupEventCounts);
});
