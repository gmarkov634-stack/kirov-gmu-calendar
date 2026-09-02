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

test('Pediatrics course 3 reviewed manifest reproduces the approved publication candidate', async () => {
  const [manifest, source, evidence, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-331-337.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-331-337.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-331-337.evidence.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-331-337.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-331-337.publication-evidence.json')
  ]);
  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const digest = digestNormalizedEvents(events);

  assert.equal(events.length, 1781);
  assert.equal(digest, 'sha256:19fcc970c203a672a4d2da12eb3e4791b48312c3c3d2d84943dc7ffd6b3129dc');
  assert.equal(digest, manifest.candidateDigest);
  assert.equal(digest, evidence.candidateDigest);
  assert.equal(digest, qa.candidateDigest);
  assert.equal(digest, publication.candidateDigest);
  assert.equal(qa.decision, 'pass');
  assert.deepEqual(qa.blockingIssues, []);
  assert.equal(publication.sharedContractEvidence.commit, 'd2f06c32509760f4b5e817f12ef1e2f2a9809ab3');
  assert.equal(publication.sharedContractEvidence.productionRuntimeCommit, '5a35ce015949c7163f41478cfc20003e2e28729d');
  assert.equal(publication.sharedContractEvidence.normalizedEventSchemaBlob, '18cce682c311659a515390ba6ce706ba4a2f4072');
  assert.equal(publication.sharedContractEvidence.icsRendererBlob, 'a9b61d6bb5da412e2f6ff0b5b85474af41e6216e');
  assert.ok(events.every((event) => event.timeSemantics === 'floating'));
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
});

test('Pediatrics course 3 publication preflight is deterministic and does not open SQLite', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-331-337.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 1781/);
  assert.match(stdout, /sha256:19fcc970c203a672a4d2da12eb3e4791b48312c3c3d2d84943dc7ffd6b3129dc/);
  assert.match(stdout, /kgmu-2026-2027-s1-pediatrics-331-19fcc970c203a672/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('Pediatrics course 3 apply fails closed before core import when production commit differs', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-331-337.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-331-337-core-'));
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
