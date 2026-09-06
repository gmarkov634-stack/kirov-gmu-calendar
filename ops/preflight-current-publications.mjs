#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPS = resolve(ROOT, 'ops');
const PUBLISHER_PATTERN = /^publish-(medicine|pediatrics|dentistry)-.+\.mjs$/;

const HISTORICAL_MIGRATIONS = new Map([
  ['publish-medicine-101-110.mjs', 'historical group-102 correction migration; not the current Medicine 101-110 publisher']
]);

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status === 0) return;
  const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new Error(`publication preflight command failed: node ${args.join(' ')}${details ? `\n${details}` : ''}`);
}

const publisherFiles = (await readdir(OPS))
  .filter((name) => PUBLISHER_PATTERN.test(name))
  .sort();

for (const historical of HISTORICAL_MIGRATIONS.keys()) {
  if (!publisherFiles.includes(historical)) {
    throw new Error(`documented historical publication entrypoint is missing: ${historical}`);
  }
}

const currentPublishers = publisherFiles.filter((name) => !HISTORICAL_MIGRATIONS.has(name));
if (currentPublishers.length === 0) throw new Error('no current publication entrypoints found');

const preflightEnv = { ...process.env };
delete preflightEnv.MEDICAL_CALENDAR_DB_PATH;
delete preflightEnv.MEDICAL_CALENDAR_CORE_ROOT;

for (const publisher of currentPublishers) {
  const relativePath = `ops/${publisher}`;
  runNode(['--check', relativePath], preflightEnv);
  runNode([relativePath, '--preflight'], preflightEnv);
  console.log(`preflight ok: ${relativePath}`);
}

console.log(JSON.stringify({
  result: 'CURRENT_PUBLICATION_PREFLIGHTS_OK',
  currentPublisherCount: currentPublishers.length,
  currentPublishers,
  historicalMigrations: [...HISTORICAL_MIGRATIONS].map(([entrypoint, reason]) => ({ entrypoint, reason })),
  databaseEnvironmentPresent: false,
  coreRootEnvironmentPresent: false
}, null, 2));
