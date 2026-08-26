import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createKgmuParsingJob } from '../src/index.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];

test('pins the server-fetched official KGMU 101-110 fixture by URL and SHA-256', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const sourceUrl = new URL(fixture.source.url);

  assert.equal(sourceUrl.protocol, 'https:');
  assert.equal(sourceUrl.hostname, 'kirovgma.ru');
  assert.ok(sourceUrl.pathname.startsWith('/sites/default/files/files/'));
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fixture.source.sha256, '8d5695ce3e2eb26da757b952a332714150a9961d4bcd6bf03b09dbbf875f52d6');
  assert.equal(fixture.source.byteLength, 21068);
  assert.deepEqual(fixture.expectedGroupIds, EXPECTED_GROUPS);
  assert.equal(fixture.storagePolicy.repositoryStoresBinarySource, false);
  assert.equal(fixture.storagePolicy.productionSourceIsServerFetched, true);
  assert.equal(fixture.storagePolicy.immutableSourceStoredInObjectStorage, true);
});

test('uses the canonical versioned KGMU rule bundle and fails closed on ambiguity', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const manifest = await readJson('../parser-rules/v1/manifest.json');
  const qa = await readJson('../qa/policy.json');

  assert.equal(fixture.parserRulesVersion, manifest.parserRulesVersion);
  assert.deepEqual(manifest.profiles.weekly, ['general', 'weekly']);
  assert.equal(manifest.canonicalDocumentation.general.ruleRange, 'G01-G21');
  assert.equal(manifest.canonicalDocumentation.weekly.ruleRange, 'R01-R89;P01-P25');
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

test('builds exactly the medical-calendar-core v1 ParsingJob surface', async () => {
  const fixture = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json');
  const job = createKgmuParsingJob({
    jobId: 'parsing-job-101-110-1',
    academicPeriodId: fixture.academicPeriodId,
    sourceId: fixture.source.sourceId,
    sourceObjectKey: `sources/kirov-gmu/${fixture.academicYear}/semester-1/${fixture.source.sha256}.xlsx`,
    parserRulesVersion: fixture.parserRulesVersion,
    expectedGroupIds: fixture.expectedGroupIds,
    requestedAt: '2026-08-27T00:00:00Z'
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
    parserRulesVersion: 'kgmu-2026-08-27-v1',
    expectedGroupIds: ['101'],
    requestedAt: '2026-08-27T00:00:00Z'
  };

  assert.throws(() => createKgmuParsingJob({ ...base, expectedGroupIds: ['101', '101'] }), /unique/);
  assert.throws(() => createKgmuParsingJob({ ...base, requestedAt: 'not-a-date' }), /date-time/);
  assert.throws(() => createKgmuParsingJob({ ...base, requestedAt: '2026-08-27' }), /date-time/);
  assert.doesNotThrow(() => createKgmuParsingJob({ ...base, requestedAt: '2026-08-27T03:00:00+03:00' }));
});
