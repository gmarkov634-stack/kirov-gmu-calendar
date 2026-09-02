import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function fixtures() {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-231-239.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-231-239.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-231-239.evidence.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-231-239.qa-report.json')
  ]);
  return { manifest, source, evidence, qa };
}

test('builds deterministic Pediatrics course 2 publication plan from approved QA candidate', async () => {
  const input = await fixtures();
  const plan = buildExplicitPublicationPlan(input);

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.programId, 'pediatrics');
  assert.equal(plan.academicYearId, '2026-2027');
  assert.equal(plan.academicPeriodId, '2026-2027-semester-1');
  assert.equal(plan.events.length, 2353);
  assert.equal(plan.versions.length, 9);
  assert.deepEqual(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['231',261],['232',262],['233',262],['234',261],['235',261],
    ['236',262],['237',262],['238',262],['239',260]
  ]);
  assert.equal(plan.versions[0].versionId, 'kgmu-2026-2027-s1-pediatrics-231-59ea4ed15af1678e');
  assert.equal(plan.candidateDigest, 'sha256:59ea4ed15af1678e205f62c56ee9fa7c7fc74e40570d19c8b1f6b4098e1bfb20');
  assert.equal(plan.coreEvidence.commit, '8643642a4aa889b8e8dc1b444a7c2ea3719d0602');
  assert.equal(plan.coreEvidence.productionRuntimeCommit, '5a35ce015949c7163f41478cfc20003e2e28729d');
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, '18cce682c311659a515390ba6ce706ba4a2f4072');
  assert.equal(plan.coreEvidence.icsRendererBlob, 'a9b61d6bb5da412e2f6ff0b5b85474af41e6216e');

  assert.equal(plan.events.filter((event) => event.facultativeId != null).length, 0);
  assert.ok(plan.events.every((event) => event.timeSemantics === 'floating'));
  assert.ok(plan.events.every((event) => event.date >= '2026-09-01' && event.date <= '2026-12-30'));
  assert.equal(new Set(plan.events.map((event) => event.eventId)).size, plan.events.length);

  const confirmed = plan.events.filter((event) =>
    event.groupId === '233'
    && event.discipline === 'Биохимия'
    && event.date === '2026-12-08'
    && event.startTime === '09:30'
    && event.endTime === '10:15'
    && event.sourceRef.locator === '2пед.!D11#s2'
  );
  assert.equal(confirmed.length, 1);
});

test('Pediatrics course 2 publication preflight verifies the approved candidate without SQLite changes', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-231-239.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 2353/);
  assert.match(stdout, /sha256:59ea4ed15af1678e205f62c56ee9fa7c7fc74e40570d19c8b1f6b4098e1bfb20/);
  assert.match(stdout, /kgmu-2026-2027-s1-pediatrics-231-59ea4ed15af1678e/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('Pediatrics course 2 apply rejects the approved main commit when it is not the audited production runtime', async () => {
  const input = await fixtures();
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-231-239.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-231-239-core-'));
  try {
    await writeFile(join(coreRoot, '.deployed-commit'), `${input.qa.sharedContractEvidence.commit}\n`, 'utf8');
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

test('Pediatrics course 2 apply fails closed before core import when deployed commit differs', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-231-239.mjs', import.meta.url));
  const coreRoot = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-231-239-core-'));
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

test('Pediatrics course 2 publication plan fails closed if QA is not pass', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.decision = 'fail';
  assert.throws(() => buildExplicitPublicationPlan(input), /QA decision must be pass/);
});

test('Pediatrics course 2 publication plan fails closed if candidate digest diverges', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.candidateDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => buildExplicitPublicationPlan(input), /evidence\/QA candidate digest mismatch/);
});
