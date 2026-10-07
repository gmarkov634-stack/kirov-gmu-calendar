#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPS = resolve(ROOT, 'ops');
const PUBLISHER_PATTERN = /^publish-(medicine|pediatrics|dentistry)-.+\.mjs$/;

const HISTORICAL_MIGRATIONS = new Map([
  ['publish-medicine-101-110.mjs', 'historical group-102 correction migration; not the current Medicine 101-110 publisher']
]);

const EXPECTED_BLOCKED_PUBLICATIONS = new Map([
  ['publish-dentistry-191-194.mjs', {
    sourcePath: 'fixtures/2026-2027-semester-1/dentistry-191-194.source.json',
    reason: 'current official source revision is semantic REVIEW_REQUIRED'
  }]
]);

function runNodeResult(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function commandDetails(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function requireNodeSuccess(args, env) {
  const result = runNodeResult(args, env);
  if (result.status === 0) return result;
  const details = commandDetails(result);
  throw new Error(`publication preflight command failed: node ${args.join(' ')}${details ? `\n${details}` : ''}`);
}

async function requireExpectedBlockedPublication(publisher, config, env) {
  const source = JSON.parse(await readFile(resolve(ROOT, config.sourcePath), 'utf8'));
  const lifecycle = source.lifecycle;
  if (!lifecycle || lifecycle.publicationAllowed !== false) {
    throw new Error(
      `expected-blocked publication no longer has publicationAllowed=false: ${publisher} (${config.sourcePath})`
    );
  }
  if (typeof lifecycle.status !== 'string' || lifecycle.status.length === 0) {
    throw new Error(`expected-blocked publication is missing lifecycle.status: ${publisher}`);
  }

  const relativePath = `ops/${publisher}`;
  requireNodeSuccess(['--check', relativePath], env);
  const result = runNodeResult([relativePath, '--preflight'], env);
  const details = commandDetails(result);
  if (result.status === 0) {
    throw new Error(`expected publication preflight to fail closed but it succeeded: ${relativePath}`);
  }
  const expectedMarker = `publication blocked by source lifecycle: ${lifecycle.status}`;
  if (!details.includes(expectedMarker)) {
    throw new Error(
      `expected publication lifecycle block was not observed: ${relativePath}\n` +
      `expected marker: ${expectedMarker}\n${details}`
    );
  }
  return {
    entrypoint: publisher,
    sourcePath: config.sourcePath,
    lifecycleStatus: lifecycle.status,
    reason: config.reason
  };
}

const publisherFiles = (await readdir(OPS))
  .filter((name) => PUBLISHER_PATTERN.test(name))
  .sort();

for (const historical of HISTORICAL_MIGRATIONS.keys()) {
  if (!publisherFiles.includes(historical)) {
    throw new Error(`documented historical publication entrypoint is missing: ${historical}`);
  }
}
for (const blocked of EXPECTED_BLOCKED_PUBLICATIONS.keys()) {
  if (!publisherFiles.includes(blocked)) {
    throw new Error(`documented expected-blocked publication entrypoint is missing: ${blocked}`);
  }
}

const currentPublishers = publisherFiles.filter((name) => !HISTORICAL_MIGRATIONS.has(name));
if (currentPublishers.length === 0) throw new Error('no current publication entrypoints found');

const preflightEnv = { ...process.env };
delete preflightEnv.MEDICAL_CALENDAR_DB_PATH;
delete preflightEnv.MEDICAL_CALENDAR_CORE_ROOT;

const blockedAsExpected = [];
const successfulPreflights = [];
for (const publisher of currentPublishers) {
  const blockedConfig = EXPECTED_BLOCKED_PUBLICATIONS.get(publisher);
  if (blockedConfig) {
    const blocked = await requireExpectedBlockedPublication(publisher, blockedConfig, preflightEnv);
    blockedAsExpected.push(blocked);
    console.log(`preflight blocked as expected: ops/${publisher} (${blocked.lifecycleStatus})`);
    continue;
  }

  const relativePath = `ops/${publisher}`;
  requireNodeSuccess(['--check', relativePath], preflightEnv);
  requireNodeSuccess([relativePath, '--preflight'], preflightEnv);
  successfulPreflights.push(publisher);
  console.log(`preflight ok: ${relativePath}`);
}

console.log(JSON.stringify({
  result: 'CURRENT_PUBLICATION_PREFLIGHTS_OK',
  currentPublisherCount: currentPublishers.length,
  currentPublishers,
  successfulPreflights,
  blockedAsExpected,
  historicalMigrations: [...HISTORICAL_MIGRATIONS].map(([entrypoint, reason]) => ({ entrypoint, reason })),
  databaseEnvironmentPresent: false,
  coreRootEnvironmentPresent: false
}, null, 2));
