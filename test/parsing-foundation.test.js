import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createKgmuParsingJob } from '../src/index.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];

test('pins the current server-fetched official KGMU 101-110 fixture by URL and SHA-256', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const sourceUrl = new URL(fixture.source.url);

  assert.equal(sourceUrl.protocol, 'https:');
  assert.equal(sourceUrl.hostname, 'kirovgma.ru');
  assert.equal(
    fixture.source.url,
    'https://kirovgma.ru/sites/default/files/files/2026/08/27/1078/1_lech._1_potok-27-08-2026-11.xlsx'
  );
  assert.equal(fixture.source.sha256, '341f5bce70de3b6a483f7edfe83fe37ec02e70a4aaccb043aa77a23f9222255b');
  assert.equal(fixture.source.byteLength, 21119);
  assert.deepEqual(fixture.expectedGroupIds, EXPECTED_GROUPS);
  assert.equal(fixture.storagePolicy.repositoryStoresBinarySource, false);
  assert.equal(fixture.storagePolicy.productionSourceIsServerFetched, true);
  assert.equal(fixture.storagePolicy.immutableSourceStoredInObjectStorage, true);
});

test('uses the current canonical KGMU rule bundle and fails closed on ambiguity', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const manifest = await readJson('../parser-rules/v1/manifest.json');
  const qa = await readJson('../qa/policy.json');

  assert.equal(fixture.parserRulesVersion, 'kgmu-2026-08-27-v3');
  assert.equal(manifest.parserRulesVersion, 'kgmu-2026-08-27-v3');
  assert.deepEqual(manifest.profiles.weekly, ['general', 'weekly']);
  assert.equal(manifest.canonicalDocumentation.general.ruleRange, 'G01-G21');
  assert.equal(manifest.canonicalDocumentation.general.exportSha256, 'f935f05639debb09f43909be640e1abb6f4ee58fe33bc1e0d3adc908643928d3');
  assert.equal(manifest.canonicalDocumentation.weekly.ruleRange, 'R01-R89;P01-P25');
  assert.equal(manifest.canonicalDocumentation.weekly.exportSha256, '03aa715ca47f371a12ba758d56c890c7ab0e92c0674ea41f86768702ea52788d');
  assert.equal(manifest.ambiguityPolicy.status, 'REVIEW_REQUIRED');
  assert.equal(manifest.ambiguityPolicy.requiresUserConfirmation, true);
  assert.equal(manifest.ambiguityPolicy.blocksPublication, true);
  assert.equal(manifest.ambiguityPolicy.guessingAllowed, false);
  assert.equal(qa.ambiguity.status, 'REVIEW_REQUIRED');
  assert.equal(qa.ambiguity.requiresUserConfirmation, true);
  assert.equal(qa.ambiguity.blocksPublication, true);
  assert.equal(qa.ambiguity.automaticGuessing, false);
  assert.ok(qa.requiredChecks.includes('unresolved-ambiguities-zero-before-pass'));
});

test('builds exactly the medical-calendar-core v1 ParsingJob surface with the current rule version', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const manifest = await readJson('../parser-rules/v1/manifest.json');
  const job = createKgmuParsingJob({
    jobId: 'parsing-job-101-110-refresh-2026-08-29',
    academicPeriodId: fixture.academicPeriodId,
    sourceId: fixture.source.sourceId,
    sourceObjectKey: `sources/kirov-gmu/${fixture.academicYear}/semester-1/${fixture.source.sha256}.xlsx`,
    parserRulesVersion: manifest.parserRulesVersion,
    expectedGroupIds: fixture.expectedGroupIds,
    requestedAt: '2026-08-29T00:00:00Z'
  });

  assert.deepEqual(Object.keys(job), [
    'jobId',
    'universityId',
    'academicPeriodId',
    'sourceId',
    'sourceObjectKey',
    'parserRulesVersion',
    'expectedGroupIds',
    'requestedAt'
  ]);
  assert.equal(job.universityId, 'kirov-gmu');
  assert.equal(job.parserRulesVersion, 'kgmu-2026-08-27-v3');
  assert.deepEqual(job.expectedGroupIds, EXPECTED_GROUPS);
  assert.equal(Object.hasOwn(job, 'sourceUrl'), false);
  assert.equal(Object.hasOwn(job, 'rawSource'), false);
});

test('rejects duplicate expected groups and invalid request timestamps', () => {
  const base = {
    jobId: 'job',
    academicPeriodId: '2026-2027-semester-1',
    sourceId: 'medicine',
    sourceObjectKey: 'sources/example.xlsx',
    parserRulesVersion: 'kgmu-2026-08-27-v3',
    expectedGroupIds: ['101'],
    requestedAt: '2026-08-29T00:00:00Z'
  };

  assert.throws(() => createKgmuParsingJob({ ...base, expectedGroupIds: ['101', '101'] }), /unique/);
  assert.throws(() => createKgmuParsingJob({ ...base, requestedAt: 'not-a-date' }), /date-time/);
  assert.throws(() => createKgmuParsingJob({ ...base, requestedAt: '2026-08-29' }), /date-time/);
  assert.doesNotThrow(() => createKgmuParsingJob({ ...base, requestedAt: '2026-08-29T03:00:00+03:00' }));
});
