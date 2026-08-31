import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const APPROVED_SOURCE_SHA256 = '0b5c4a06fd45e50bdaf28586fcb3f4bddade4efe514bc54dd84c359aa04fcb23';
const APPROVED_CANDIDATE_DIGEST = 'sha256:4126d3adfeb289ee5e47b27a55960d748ee4aa596b227ba4922f40bf1b5b069c';
const GROUPS = Array.from({ length: 16 }, (_, index) => String(601 + index));

const [manifest, source, evidence, qa] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-601-616.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-601-616.source.json'),
  readJson('qa/2026-2027-semester-1/medicine-601-616.evidence.json'),
  readJson('qa/2026-2027-semester-1/medicine-601-616.qa-report.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

test('medicine 601-616 publication gate is pinned to the approved QA candidate', () => {
  assert.equal(source.source.sha256, APPROVED_SOURCE_SHA256);
  assert.equal(manifest.sourceSha256, APPROVED_SOURCE_SHA256);
  assert.equal(evidence.source.sha256, APPROVED_SOURCE_SHA256);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.equal(evidence.candidate.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.deepEqual(source.expectedGroupIds, GROUPS);
  assert.deepEqual(manifest.groupTable, GROUPS);
  assert.equal(events.length, 1456);
  assert.equal(digestNormalizedEvents(events), APPROVED_CANDIDATE_DIGEST);
});

test('medicine 601-616 approved candidate is exactly 91 events per group', () => {
  for (const groupId of GROUPS) {
    const count = events.filter((event) => event.groupId === groupId).length;
    assert.equal(count, 91, `group ${groupId}`);
    assert.equal(evidence.candidate.groupEventCounts[groupId], 91, `evidence group ${groupId}`);
  }
});

test('medicine 601-616 publication preflight is read-only and reproducible', () => {
  const result = spawnSync(process.execPath, ['ops/publish-medicine-601-616.mjs', '--preflight'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"mode": "preflight"/);
  assert.match(result.stdout, /"groupCount": 16/);
  assert.match(result.stdout, /"eventCount": 1456/);
  assert.match(result.stdout, /sha256:4126d3adfeb289ee5e47b27a55960d748ee4aa596b227ba4922f40bf1b5b069c/);
  assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});
