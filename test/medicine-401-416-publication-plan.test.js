import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const APPROVED_SOURCE_SHA256 = 'fb79b4c7b08b8f85bd2f238f2190404ea5eae01ab2be47339985272b565ead6b';
const APPROVED_CANDIDATE_DIGEST = 'sha256:a38c8269bfd22ea511e9a91fa433dc0c5ae073defcd9722d08c9f6afb2511f1f';
const GROUPS = Array.from({ length: 16 }, (_, index) => String(401 + index));
const EXPECTED_GROUP_EVENT_COUNTS = Object.fromEntries(GROUPS.map((groupId) => [groupId, Number(groupId) <= 410 ? 144 : 145]));

const [manifest, source, evidence, qa] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-401-416.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-401-416.source.json'),
  readJson('qa/2026-2027-semester-1/medicine-401-416.evidence.json'),
  readJson('qa/2026-2027-semester-1/medicine-401-416.qa-report.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

test('medicine 401-416 publication gate is pinned to the approved QA candidate', () => {
  assert.equal(source.source.sha256, APPROVED_SOURCE_SHA256);
  assert.equal(manifest.sourceSha256, APPROVED_SOURCE_SHA256);
  assert.equal(evidence.source.sha256, APPROVED_SOURCE_SHA256);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.equal(evidence.candidate.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.deepEqual(source.expectedGroupIds, GROUPS);
  assert.deepEqual(manifest.groupTable, GROUPS);
  assert.equal(events.length, 2310);
  assert.equal(digestNormalizedEvents(events), APPROVED_CANDIDATE_DIGEST);
});

test('medicine 401-416 approved candidate has the exact QA-backed per-group counts', () => {
  for (const groupId of GROUPS) {
    const expectedCount = EXPECTED_GROUP_EVENT_COUNTS[groupId];
    const count = events.filter((event) => event.groupId === groupId).length;
    assert.equal(count, expectedCount, `group ${groupId}`);
    assert.equal(evidence.candidate.groupEventCounts[groupId], expectedCount, `evidence group ${groupId}`);
  }
});

test('medicine 401-416 publication preflight is read-only and reproducible', () => {
  const result = spawnSync(process.execPath, ['ops/publish-medicine-401-416.mjs', '--preflight'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"mode": "preflight"/);
  assert.match(result.stdout, /"groupCount": 16/);
  assert.match(result.stdout, /"eventCount": 2310/);
  assert.match(result.stdout, /sha256:a38c8269bfd22ea511e9a91fa433dc0c5ae073defcd9722d08c9f6afb2511f1f/);
  assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});
