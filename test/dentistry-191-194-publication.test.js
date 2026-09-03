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

test('Dentistry course 1 normalized draft is the approved publication candidate', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/dentistry-191-194.source.json'),
    readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191-194.normalized.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json')
  ]);

  assert.equal(source.programId, 'dentistry');
  assert.equal(source.course, 1);
  assert.deepEqual(source.expectedGroupIds, ['191', '192', '193', '194']);
  assert.equal(draft.events.length, 1656);
  assert.equal(draft.candidateDigest, 'sha256:60851036434561dadc342752b19aca8384169c51d33e16529e90cbaa9e4f0c91');
  assert.equal(draft.candidateDigest, qa.candidateDigest);
  assert.equal(draft.candidateDigest, publication.candidateDigest);
  assert.equal(digestNormalizedEvents(draft.events), 'sha256:26345b104791dd2635560ebbf062329797c8328efe9e49eb066232623627d374');
  assert.equal(digestNormalizedEvents(draft.events), publication.eventSetDigest);
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.readyForScheduleVersion, true);
  assert.equal(qa.unresolvedSemanticItemCount, 0);
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, draft.events.length);
  assert.ok(draft.events.every((event) => event.timeSemantics === 'floating'));

  const groupCounts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
    groupId,
    draft.events.filter((event) => event.groupId === groupId).length
  ]));
  assert.deepEqual(groupCounts, publication.groupEventCounts);

  const facultativeIds = [...new Set(draft.events.filter((event) => event.facultativeId != null).map((event) => event.facultativeId))].sort();
  assert.deepEqual(facultativeIds, [...publication.facultativeIds].sort());
  for (const groupId of source.expectedGroupIds) {
    const events = draft.events.filter((event) => event.groupId === groupId);
    const facultativeCount = events.filter((event) => event.facultativeId != null).length;
    assert.equal(facultativeCount, publication.groupFacultativeEventCounts[groupId]);
    assert.equal(events.length - facultativeCount, publication.groupDefaultVisibleEventCounts[groupId]);
  }

  assert.equal(publication.sharedContractEvidence.productionRuntimeCommit, 'e5414c1d8b8754f8e47397f24d7aeb5d413431ec');
  assert.equal(publication.sharedContractEvidence.normalizedEventSchemaBlob, '027699254f920e30822ca26214ddc0746c258c3c');
  assert.equal(publication.sharedContractEvidence.icsRendererBlob, 'b75aea9bd6b54fab9ae454c1f7fedcf233d8ea96');
});

test('Dentistry course 1 publication preflight is deterministic and does not open SQLite', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 1656/);
  assert.match(stdout, /sha256:60851036434561dadc342752b19aca8384169c51d33e16529e90cbaa9e4f0c91/);
  assert.match(stdout, /sha256:26345b104791dd2635560ebbf062329797c8328efe9e49eb066232623627d374/);
  assert.match(stdout, /kgmu-2026-2027-s1-dentistry-191-60851036434561da/);
  assert.match(stdout, /kgmu-2026-2027-s1-dentistry-facultative-biology/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('Dentistry course 1 apply fails closed before core import when production commit differs', async () => {
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
        assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /deployed core commit mismatch/);
        return true;
      }
    );
  } finally {
    await rm(coreRoot, { recursive: true, force: true });
  }
});
