import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildMedicinePublicationPlan,
  toCorePublicationQa
} from '../src/medicine-publication-plan.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function fixtures() {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);
  return { manifest, source, evidence, qa };
}

test('builds deterministic first-publication plan from approved explicit decisions', async () => {
  const input = await fixtures();
  const plan = buildMedicinePublicationPlan(input);

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.academicYearId, '2026-2027');
  assert.equal(plan.academicPeriodId, '2026-2027-semester-1');
  assert.equal(plan.events.length, 3429);
  assert.equal(plan.versions.length, 10);
  assert.deepEqual(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['101',336],['102',335],['103',335],['104',335],['105',336],
    ['106',336],['107',347],['108',347],['109',361],['110',361]
  ]);
  assert.equal(
    plan.versions[0].versionId,
    'kgmu-2026-2027-s1-medicine-101-5282de1dcec279ac'
  );
  assert.equal(plan.candidateDigest, 'sha256:5282de1dcec279ac4d035d55ea57d293d8ed0294ecc1cb0e3446e7a4e7a3f20a');
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, 'f40a8d7efef1cf362cea9a82976dd86d431186b8');
  assert.equal(plan.coreEvidence.icsRendererBlob, '94cbd7d50aa4af2028ab27298cc05592ee3d51b7');
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

test('fails closed if QA is not pass', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.decision = 'fail';
  assert.throws(() => buildMedicinePublicationPlan(input), /QA decision must be pass/);
});

test('fails closed if candidate digest no longer matches explicit decisions', async () => {
  const input = await fixtures();
  input.qa = structuredClone(input.qa);
  input.qa.candidateDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => buildMedicinePublicationPlan(input), /manifest\/QA candidate digest mismatch/);
});

test('fails closed if source fingerprint diverges from the approved manifest', async () => {
  const input = await fixtures();
  input.source = structuredClone(input.source);
  input.source.source.sha256 = 'deadbeef';
  assert.throws(() => buildMedicinePublicationPlan(input), /manifest\/source SHA-256 mismatch/);
});
