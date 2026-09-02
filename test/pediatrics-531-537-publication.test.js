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

test('Pediatrics course 5 normalized draft is the approved publication candidate', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-531-537.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-531-537.normalized-draft.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-531-537.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-531-537.publication-evidence.json')
  ]);
  const digest = digestNormalizedEvents(draft.events);

  assert.equal(draft.events.length, 910);
  assert.equal(digest, 'sha256:62811141f1183c303ac854ea58012085bd2e15bf9b873148e31bb2f7fb49eb2a');
  assert.equal(digest, draft.candidateDigest);
  assert.equal(digest, qa.candidateDigest);
  assert.equal(digest, publication.candidateDigest);
  assert.equal(draft.status, 'PASS');
  assert.equal(qa.decision, 'pass');
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
  assert.deepEqual(Object.fromEntries(source.expectedGroupIds.map((groupId) => [groupId, draft.events.filter((event) => event.groupId === groupId).length])), publication.groupEventCounts);
  assert.ok(draft.events.every((event) => event.timeSemantics === 'floating'));
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, draft.events.length);
  assert.equal(draft.events.filter((event) => event.discipline === 'Дисциплины по физической культуре и спорту').length, 105);
  assert.equal(publication.sharedContractEvidence.commit, '8643642a4aa889b8e8dc1b444a7c2ea3719d0602');
  assert.equal(publication.sharedContractEvidence.productionRuntimeCommit, '5a35ce015949c7163f41478cfc20003e2e28729d');
});

test('Pediatrics course 5 publication preflight is deterministic and does not open SQLite', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-531-537.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 910/);
  assert.match(stdout, /sha256:62811141f1183c303ac854ea58012085bd2e15bf9b873148e31bb2f7fb49eb2a/);
  assert.match(stdout, /kgmu-2026-2027-s1-pediatrics-531-62811141f1183c30/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('Pediatrics course 5 apply fails closed before core import when production commit differs', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-531-537.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-531-537-core-'));
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
