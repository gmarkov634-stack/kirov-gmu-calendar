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
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);
  return { manifest, facultatives, source, evidence, qa };
}

test('builds deterministic medicine publication plan including confirmed facultatives', async () => {
  const input = await fixtures();
  const plan = buildMedicinePublicationPlan(input);

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.academicYearId, '2026-2027');
  assert.equal(plan.academicPeriodId, '2026-2027-semester-1');
  assert.equal(plan.events.length, 4349);
  assert.equal(plan.events.filter((event) => event.facultativeId).length, 920);
  assert.equal(plan.versions.length, 10);
  assert.deepEqual(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['101',428],['102',427],['103',427],['104',427],['105',428],
    ['106',428],['107',439],['108',439],['109',453],['110',453]
  ]);
  assert.equal(
    plan.versions[0].versionId,
    'kgmu-2026-2027-s1-medicine-101-26b6a9b1d2e6c234'
  );
  assert.equal(plan.candidateDigest, 'sha256:26b6a9b1d2e6c2346661f2384accae7a8766d828e801ceaa9fb0dc46aacf22a2');
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, '18cce682c311659a515390ba6ce706ba4a2f4072');
  assert.equal(plan.coreEvidence.icsRendererBlob, 'a2223de3a6489f12f06d7380575c3f68858995b5');
});

test('facultative fixture expands all five options with stable ids', async () => {
  const input = await fixtures();
  const plan = buildMedicinePublicationPlan(input);
  const facultatives = plan.events.filter((event) => event.facultativeId);
  assert.equal(new Set(facultatives.map((event) => event.facultativeId)).size, 5);
  assert.equal(facultatives.filter((event) => event.groupId === '101').length, 92);
  assert.ok(facultatives.some((event) =>
    event.groupId === '101' &&
    event.date === '2026-09-01' &&
    event.discipline === 'Основы химии' &&
    event.startTime === '16:50' &&
    event.endTime === '18:20'
  ));
  assert.ok(facultatives.some((event) =>
    event.groupId === '110' &&
    event.date === '2027-01-15' &&
    event.discipline === 'Русский язык и культура речи'
  ));
});

test('projects repository QA evidence to the strict core publication QaReport surface', async () => {
  const { qa } = await fixtures();
  assert.ok(qa.sharedContractEvidence);
  const projected = toCorePublicationQa(qa);
  assert.deepEqual(Object.keys(projected).sort(), [
    'candidateDigest','checks','createdAt','decision','parsingJobId','qaReportId'
  ]);
  assert.equal('sharedContractEvidence' in projected, false);
  assert.equal(projected.decision, 'pass');
});

test('publication runner preflight expands and verifies without opening production SQLite', async () => {
  const script = fileURLToPath(new URL('../ops/publish-medicine-101-110.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 4349/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('fails closed if QA is not pass', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.decision = 'fail';
  assert.throws(() => buildMedicinePublicationPlan(input), /QA decision must be pass/);
});

test('fails closed if candidate digest no longer matches QA evidence', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.candidateDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => buildMedicinePublicationPlan(input), /evidence\/QA candidate digest mismatch/);
});

test('fails closed if source fingerprint diverges from the approved fixtures', async () => {
  const input = await fixtures();
  input.source = structuredClone(input.source);
  input.source.source.sha256 = 'deadbeef';
  assert.throws(() => buildMedicinePublicationPlan(input), /manifest\/source SHA-256 mismatch/);
});
