import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('Dentistry course 1 current reviewed candidate is internally exact but platform-gated', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/dentistry-191-194.source.json'),
    readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191-194.normalized.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json')
  ]);

  assert.equal(source.programId, 'dentistry');
  assert.equal(source.course, 1);
  assert.deepEqual(source.expectedGroupIds, ['191', '192', '193', '194']);
  assert.equal(draft.events.length, 1669);
  assert.equal(draft.candidateDigest, 'sha256:577393c16cac90055fcc8ef1ba5d69fdca2be213b699773e0a83205b84122487');
  assert.equal(draft.candidateDigest, qa.candidateDigest);
  assert.equal(draft.candidateDigest, publication.candidateDigest);
  assert.equal(digestNormalizedEvents(draft.events), 'sha256:8e433532541a8b8f642e6dc14ae18ba06b569c0743278c0ac63a07a083935405');
  assert.equal(digestNormalizedEvents(draft.events), publication.eventSetDigest);
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.readyForScheduleVersion, true);
  assert.equal(qa.unresolvedSemanticItemCount, 0);
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, draft.events.length);
  assert.ok(draft.events.every((event) => event.timeSemantics === 'floating'));

  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(publication.publicationAllowed, false);
  assert.equal(publication.platformCompatibility.status, 'review-required');

  const groupCounts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    draft.events.filter((event) => event.groupId === groupId).length
  ]));
  assert.deepEqual(groupCounts, publication.groupEventCounts);
  assert.deepEqual(groupCounts, { '191': 428, '192': 413, '193': 414, '194': 414 });

  const facultativeIds = [...new Set(draft.events.filter((event) => event.facultativeId != null).map((event) => event.facultativeId))].sort();
  assert.deepEqual(facultativeIds, [...publication.facultativeIds].sort());
  for (const groupId of source.expectedGroupIds) {
    const events = draft.events.filter((event) => event.groupId === groupId);
    const facultativeCount = events.filter((event) => event.facultativeId != null).length;
    assert.equal(facultativeCount, 85);
    assert.equal(facultativeCount, publication.groupFacultativeEventCounts[groupId]);
    assert.equal(events.length - facultativeCount, publication.groupDefaultVisibleEventCounts[groupId]);
  }
});

test('Dentistry course 1 legacy publication preflight fails closed before platform compatibility', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--preflight']),
    (error) => {
      assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /publication gate is fail-closed pending medschedule-platform exact-SHA compatibility/);
      return true;
    }
  );
});

test('Dentistry course 1 apply fails closed before legacy core or database checks', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-dentistry-191-194-core-'));
  try {
    await writeFile(join(coreRoot, '.deployed-commit'), `${'0'.repeat(40)}\n`, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, [script, '--apply'], {
        env: {
          ...process.env,
          MEDICAL_CALENDAR_CORE_ROOT: coreRoot,
          MEDICAL_CALENDAR_DB_PATH: join(coreRoot, 'runtime.sqlite')
        }
      }),
      (error) => {
        const output = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        assert.match(output, /publication gate is fail-closed pending medschedule-platform exact-SHA compatibility/);
        assert.doesNotMatch(output, /deployed core commit mismatch/);
        return true;
      }
    );
  } finally {
    await rm(coreRoot, { recursive: true, force: true });
  }
});
