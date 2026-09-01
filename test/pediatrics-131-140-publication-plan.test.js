import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildPediatricsPublicationPlan,
  toCorePublicationQa
} from '../src/pediatrics-publication-plan.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function fixtures() {
  const [manifest, facultatives, source, evidence, qa] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-131-140.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-131-140.facultatives.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-131-140.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-131-140.evidence.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-131-140.qa-report.json')
  ]);
  return { manifest, facultatives, source, evidence, qa };
}

test('builds deterministic pediatrics 131-140 publication plan from approved QA candidate', async () => {
  const input = await fixtures();
  const plan = buildPediatricsPublicationPlan(input);

  assert.equal(plan.universityId, 'kirov-gmu');
  assert.equal(plan.programId, 'pediatrics');
  assert.equal(plan.academicYearId, '2026-2027');
  assert.equal(plan.academicPeriodId, '2026-2027-semester-1');
  assert.equal(plan.events.length, 3819);
  assert.equal(plan.events.filter((event) => event.facultativeId).length, 920);
  assert.equal(plan.versions.length, 10);
  assert.deepEqual(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['131',381],['132',382],['133',382],['134',383],['135',382],
    ['136',383],['137',381],['138',381],['139',383],['140',381]
  ]);
  assert.equal(
    plan.versions[0].versionId,
    'kgmu-2026-2027-s1-pediatrics-131-ffd0fc5cc78fe0db'
  );
  assert.equal(
    plan.candidateDigest,
    'sha256:ffd0fc5cc78fe0dbfb9f8577c5dd37d58713c3551260a810c5f77096bda7626e'
  );
  assert.equal(plan.coreEvidence.commit, '2ad1ca3c94b35701a73ade5735d1c5257604a8a0');
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, '18cce682c311659a515390ba6ce706ba4a2f4072');
  assert.equal(plan.coreEvidence.icsRendererBlob, 'a9b61d6bb5da412e2f6ff0b5b85474af41e6216e');

  assert.ok(plan.events.every((event) => event.timeSemantics === 'floating'));
  assert.ok(plan.events.every((event) => event.date >= '2026-09-01' && event.date <= '2027-01-16'));
  assert.equal(new Set(plan.events.map((event) => event.eventId)).size, plan.events.length);
});

test('locks the user-confirmed 15 December group 140 practice location to KODKB', async () => {
  const input = await fixtures();
  const plan = buildPediatricsPublicationPlan(input);
  const events = plan.events.filter((event) =>
    event.groupId === '140'
    && event.date === '2026-12-15'
    && event.discipline.startsWith('Учебная практика.')
    && event.startTime === '11:00'
    && event.endTime === '14:10'
  );
  assert.equal(events.length, 1);
  assert.equal(
    events[0].location,
    'Кировская областная детская клиническая больница (КОДКБ), ул. Менделеева, 16'
  );
  assert.equal(events[0].sourceRef.locator, '1 пед. 10 гр.!K16#s3');
});

test('keeps R17 curator hours bounded and R83 cross-day extras source-backed', async () => {
  const input = await fixtures();
  const plan = buildPediatricsPublicationPlan(input);
  const base = plan.events.filter((event) => event.facultativeId == null);

  const curator131 = base.filter((event) =>
    event.groupId === '131'
    && event.discipline === 'Час куратора'
    && event.sourceRef.locator === '1 пед. 10 гр.!B19#s1'
  );
  assert.deepEqual(curator131.map((event) => event.date), ['2026-09-01', '2026-09-08']);

  const biology138Monday = base.filter((event) =>
    event.groupId === '138'
    && event.date === '2026-12-07'
    && event.discipline === 'Биология'
    && event.sourceRef.locator === '1 пед. 10 гр.!I38#s3'
  );
  assert.equal(biology138Monday.length, 1);
  assert.equal(biology138Monday[0].startTime, '15:10');
  assert.equal(biology138Monday[0].endTime, '17:35');
});

test('deduplicates the group 139 J45/J46 graded-credit while retaining group 140', async () => {
  const input = await fixtures();
  const plan = buildPediatricsPublicationPlan(input);
  const graded = plan.events.filter((event) =>
    event.date === '2027-01-16'
    && event.discipline === 'Основы российской государственности'
    && event.lessonType === 'graded-credit'
    && event.startTime === '16:40'
    && event.endTime === '19:05'
  );
  assert.equal(graded.filter((event) => event.groupId === '139').length, 1);
  assert.equal(graded.filter((event) => event.groupId === '140').length, 1);
  assert.equal(
    graded.find((event) => event.groupId === '140').sourceRef.locator,
    '1 пед. 10 гр.!J46#s1'
  );
});

test('pediatrics facultatives remain default-off and expand across all ten groups', async () => {
  const input = await fixtures();
  const plan = buildPediatricsPublicationPlan(input);
  const facultatives = plan.events.filter((event) => event.facultativeId);

  assert.equal(input.facultatives.defaultSelected, false);
  assert.equal(new Set(facultatives.map((event) => event.facultativeId)).size, 5);
  assert.equal(facultatives.length, 920);
  for (const groupId of input.source.expectedGroupIds) {
    assert.equal(facultatives.filter((event) => event.groupId === groupId).length, 92);
  }
});

test('projects pediatrics QA to the strict core publication surface', async () => {
  const { qa } = await fixtures();
  const projected = toCorePublicationQa(qa);
  assert.deepEqual(Object.keys(projected).sort(), [
    'candidateDigest','checks','createdAt','decision','parsingJobId','qaReportId'
  ]);
  assert.equal(projected.decision, 'pass');
  assert.equal(projected.candidateDigest, 'sha256:ffd0fc5cc78fe0dbfb9f8577c5dd37d58713c3551260a810c5f77096bda7626e');
});

test('pediatrics publication preflight verifies approved candidate without database changes', async () => {
  const script = fileURLToPath(new URL('../ops/publish-pediatrics-131-140.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"eventCount": 3819/);
  assert.match(stdout, /sha256:ffd0fc5cc78fe0dbfb9f8577c5dd37d58713c3551260a810c5f77096bda7626e/);
  assert.match(stdout, /kgmu-2026-2027-s1-pediatrics-131-ffd0fc5cc78fe0db/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('pediatrics publication plan fails closed if QA or digest diverges', async () => {
  const input = await fixtures();
  const badQa = structuredClone(input);
  badQa.qa.decision = 'fail';
  assert.throws(() => buildPediatricsPublicationPlan(badQa), /QA decision must be pass/);

  const badDigest = structuredClone(input);
  badDigest.qa.candidateDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => buildPediatricsPublicationPlan(badDigest), /evidence\/QA candidate digest mismatch/);
});
