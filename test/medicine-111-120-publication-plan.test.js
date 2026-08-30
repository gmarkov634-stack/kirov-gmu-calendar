import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildMedicinePublicationPlan,
  toCorePublicationQa
} from '../src/medicine-publication-plan.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function fixtures() {
  const [manifest, facultatives, source, evidence, qa] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/medicine-111-120.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-111-120.facultatives.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-111-120.source.json'),
    readJson('../qa/2026-2027-semester-1/medicine-111-120.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-111-120.qa-report.json')
  ]);
  return { manifest, facultatives, source, evidence, qa };
}

test('builds deterministic medicine 111-120 publication plan from approved QA candidate', async () => {
  const input = await fixtures();
  const plan = buildMedicinePublicationPlan(input);

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.academicYearId, '2026-2027');
  assert.equal(plan.academicPeriodId, '2026-2027-semester-1');
  assert.equal(plan.events.length, 4285);
  assert.equal(plan.events.filter((event) => event.facultativeId).length, 920);
  assert.equal(plan.versions.length, 10);
  assert.deepEqual(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['111',428],['112',428],['113',428],['114',427],['115',427],
    ['116',428],['117',423],['118',423],['119',445],['120',428]
  ]);
  assert.equal(
    plan.versions[0].versionId,
    'kgmu-2026-2027-s1-medicine-111-28356b9ed1d15678'
  );
  assert.equal(
    plan.candidateDigest,
    'sha256:28356b9ed1d15678252842e7ebee5c19ddd66b8221b6382e09322db0eea6aa71'
  );
  assert.equal(plan.coreEvidence.commit, '80fe7986e705466304dd04512e77a5a5bad019d8');
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, '18cce682c311659a515390ba6ce706ba4a2f4072');
  assert.equal(plan.coreEvidence.icsRendererBlob, '6e889cb7c8b9b9a8d8d6b94d2486454644db7c2e');

  assert.ok(plan.events.every((event) => event.timeSemantics === 'floating'));
  assert.ok(plan.events.every((event) => event.date >= '2026-09-01' && event.date <= '2027-01-16'));
  assert.equal(new Set(plan.events.map((event) => event.eventId)).size, plan.events.length);
});

test('medicine 111-120 facultatives remain default-off and expand across all ten groups', async () => {
  const input = await fixtures();
  const plan = buildMedicinePublicationPlan(input);
  const facultatives = plan.events.filter((event) => event.facultativeId);

  assert.equal(input.facultatives.defaultSelected, false);
  assert.equal(new Set(facultatives.map((event) => event.facultativeId)).size, 5);
  assert.equal(facultatives.length, 920);
  for (const groupId of input.source.expectedGroupIds) {
    assert.equal(facultatives.filter((event) => event.groupId === groupId).length, 92);
  }
});

test('projects medicine 111-120 QA to the strict core publication surface', async () => {
  const { qa } = await fixtures();
  const projected = toCorePublicationQa(qa);
  assert.deepEqual(Object.keys(projected).sort(), [
    'candidateDigest','checks','createdAt','decision','parsingJobId','qaReportId'
  ]);
  assert.equal(projected.decision, 'pass');
  assert.equal(projected.candidateDigest, 'sha256:28356b9ed1d15678252842e7ebee5c19ddd66b8221b6382e09322db0eea6aa71');
});

test('medicine 111-120 publication preflight verifies the approved candidate without SQLite changes', async () => {
  const script = fileURLToPath(new URL('../ops/publish-medicine-111-120.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 4285/);
  assert.match(stdout, /sha256:28356b9ed1d15678252842e7ebee5c19ddd66b8221b6382e09322db0eea6aa71/);
  assert.match(stdout, /kgmu-2026-2027-s1-medicine-111-28356b9ed1d15678/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('medicine 111-120 publication plan fails closed if QA is not pass', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.decision = 'fail';
  assert.throws(() => buildMedicinePublicationPlan(input), /QA decision must be pass/);
});

test('medicine 111-120 publication plan fails closed if candidate digest diverges', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.candidateDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => buildMedicinePublicationPlan(input), /evidence\/QA candidate digest mismatch/);
});
