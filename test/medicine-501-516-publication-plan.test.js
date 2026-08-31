import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const APPROVED_SOURCE_SHA256 = '43ecb37de9db7ba69153c8514f62de0b058e51c2032e0ee320b117378a740c62';
const APPROVED_CANDIDATE_DIGEST = 'sha256:369dbe3d7e0aa5709e06ba0ab0ed1c079d0ec88f89216fe869cbc331ac60f7a1';
const GROUPS = Array.from({ length: 16 }, (_, index) => String(501 + index));
const SELECTION_GROUP_ID = 'medicine-5-physical-education-stream-2026-s1';
const SELECTION_OPTIONS = ['stream-1', 'stream-2'];

const [manifest, source, evidence, qa] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-501-516.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-501-516.source.json'),
  readJson('qa/2026-2027-semester-1/medicine-501-516.evidence.json'),
  readJson('qa/2026-2027-semester-1/medicine-501-516.qa-report.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

test('medicine 501-516 publication gate is pinned to the approved QA candidate', () => {
  assert.equal(source.source.sha256, APPROVED_SOURCE_SHA256);
  assert.equal(manifest.sourceSha256, APPROVED_SOURCE_SHA256);
  assert.equal(evidence.sourceSha256, APPROVED_SOURCE_SHA256);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.equal(evidence.candidateDigest, APPROVED_CANDIDATE_DIGEST);
  assert.equal(evidence.eventCount, 2400);
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.deepEqual(source.expectedGroupIds, GROUPS);
  assert.deepEqual(manifest.groupTable, GROUPS);
  assert.equal(events.length, 2400);
  assert.equal(digestNormalizedEvents(events), APPROVED_CANDIDATE_DIGEST);
});

test('medicine 501-516 approved candidate is exactly 150 events per group', () => {
  for (const groupId of GROUPS) {
    const count = events.filter((event) => event.groupId === groupId).length;
    assert.equal(count, 150, `group ${groupId}`);
    assert.equal(evidence.groupEventCounts[groupId], 150, `evidence group ${groupId}`);
  }
});

test('medicine 501-516 PE alternatives are complete and mutually selectable', () => {
  assert.equal(evidence.selectionGroupId, SELECTION_GROUP_ID);
  assert.deepEqual(evidence.selectionOptionIds, SELECTION_OPTIONS);

  for (const groupId of GROUPS) {
    const groupEvents = events.filter((event) => event.groupId === groupId);
    const selectedEvents = groupEvents.filter((event) => event.selection?.selectionGroupId === SELECTION_GROUP_ID);
    const baseEvents = groupEvents.filter((event) => event.selection == null);

    assert.equal(baseEvents.length, 118, `base group ${groupId}`);
    assert.equal(selectedEvents.length, 32, `PE alternatives group ${groupId}`);

    for (const optionId of SELECTION_OPTIONS) {
      const optionEvents = selectedEvents.filter((event) => event.selection.selectionOptionId === optionId);
      assert.equal(optionEvents.length, 16, `${groupId} ${optionId}`);
      assert.equal(evidence.peCountsByGroupAndOption[groupId][optionId], 16, `evidence ${groupId} ${optionId}`);
    }
  }
});

test('medicine 501-516 publication preflight is read-only and reproducible', () => {
  const result = spawnSync(process.execPath, ['ops/publish-medicine-501-516.mjs', '--preflight'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"mode": "preflight"/);
  assert.match(result.stdout, /"groupCount": 16/);
  assert.match(result.stdout, /"eventCount": 2400/);
  assert.match(result.stdout, /"failClosedEventCountPerGroup": 118/);
  assert.match(result.stdout, /"personalizedEventCountPerGroup": 134/);
  assert.match(result.stdout, /sha256:369dbe3d7e0aa5709e06ba0ab0ed1c079d0ec88f89216fe869cbc331ac60f7a1/);
  assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});
