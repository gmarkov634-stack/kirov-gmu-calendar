import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const manifestPath = path.join(apiRoot, 'test', 'fixtures', 'izhgmu-historical-regression.v1.json');
const reportPath = path.join(apiRoot, 'data', 'imports', 'izhgmu-historical-regression-report.json');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest?.schema !== 'izhgmu-historical-regression/v1') throw new Error('Invalid IzhGMU historical manifest schema');
if (manifest?.university !== 'izhgmu') throw new Error('Historical manifest must be bound to izhgmu');
if (manifest?.source_mode !== 'offline_no_live_network') throw new Error('Historical regression must remain offline');
if (!Array.isArray(manifest?.tests) || manifest.tests.length === 0) throw new Error('Historical manifest has no tests');

for (const relative of manifest.tests) {
  const absolute = path.resolve(apiRoot, relative);
  if (!absolute.startsWith(`${apiRoot}${path.sep}`)) throw new Error(`Test path escapes api root: ${relative}`);
  await fs.access(absolute);
}

const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ['--test', ...manifest.tests], {
  cwd: apiRoot,
  encoding: 'utf8',
  env: { ...process.env, IZHGMU_HISTORICAL_REGRESSION: '1' },
});
const finishedAt = new Date().toISOString();

const report = {
  schema: 'izhgmu-historical-regression-report/v1',
  university: 'izhgmu',
  status: result.status === 0 ? 'PASS' : 'FAIL',
  sourceMode: manifest.source_mode,
  baseline: manifest.baseline,
  testCount: manifest.tests.length,
  tests: manifest.tests,
  startedAt,
  finishedAt,
  exitCode: result.status,
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (result.status !== 0) process.exit(result.status ?? 1);
