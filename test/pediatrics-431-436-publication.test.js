import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { digestNormalizedEvents, expandExplicitDecisionManifest } from '../src/explicit-decisions.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('Pediatrics course 4 reviewed manifest reproduces the approved publication candidate', async () => {
  const [manifest, source, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-431-436.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-431-436.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-431-436.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-431-436.publication-evidence.json')
  ]);
  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const digest = digestNormalizedEvents(events);

  assert.equal(events.length, 768);
  assert.equal(digest, 'sha256:56324602152102118f29829f4ceb99247e6d0c48c873a077441db4e615636ecd');
  assert.equal(digest, qa.candidateDigest);
  assert.equal(digest, publication.candidateDigest);
  assert.equal(qa.decision, 'pass');
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
  assert.deepEqual(Object.fromEntries(source.expectedGroupIds.map((groupId) => [groupId, events.filter((event) => event.groupId === groupId).length])), publication.groupEventCounts);
  assert.ok(events.every((event) => event.timeSemantics === 'floating'));
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
  assert.equal(publication.sharedContractEvidence.commit, '8643642a4aa889b8e8dc1b444a7c2ea3719d0602');
  assert.equal(publication.sharedContractEvidence.productionRuntimeCommit, '5a35ce015949c7163f41478cfc20003e2e28729d');
});

test('Pediatrics course 4 publication preflight is deterministic and does not open SQLite', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-431-436.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 768/);
  assert.match(stdout, /sha256:56324602152102118f29829f4ceb99247e6d0c48c873a077441db4e615636ecd/);
  assert.match(stdout, /kgmu-2026-2027-s1-pediatrics-431-5632460215210211/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('Pediatrics course 4 apply fails closed before core import when production commit differs', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-431-436.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-431-436-core-'));
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
