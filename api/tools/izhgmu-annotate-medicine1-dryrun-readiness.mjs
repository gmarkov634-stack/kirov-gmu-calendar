import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const packageDir = path.resolve(arg('--package-dir', '/tmp/izhgmu-medicine1-dryrun'));
const readiness = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine1-readiness.json'), 'utf8'));
const manifestPath = path.join(packageDir, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

if (readiness.productionAuthorized !== false || manifest.productionAuthorized !== false) {
  throw new Error('IzhGMU dry-run readiness annotation requires productionAuthorized=false');
}
if (!Array.isArray(readiness.groups) || !Array.isArray(manifest.groups) || readiness.groups.length !== manifest.groups.length) {
  throw new Error('IzhGMU dry-run/readiness group cardinality mismatch');
}

const byGroup = new Map(readiness.groups.map((item) => [String(item.groupCode), item]));
for (const group of manifest.groups) {
  const state = byGroup.get(String(group.groupCode));
  if (!state) throw new Error(`readiness state missing for group ${group.groupCode}`);
  group.contentReady = state.readiness === 'content_ready';
  group.readiness = state.readiness;
  group.blockingWarnings = state.nonElectiveBlockers.map((item) => item.warning);
  group.productionAuthorized = false;

  const reportPath = path.join(packageDir, String(group.groupCode), 'report.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.contentReady = group.contentReady;
  report.readiness = group.readiness;
  report.blockingWarnings = group.blockingWarnings;
  report.productionAuthorized = false;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

manifest.contentReady = manifest.groups.every((item) => item.contentReady);
manifest.summary = {
  ...manifest.summary,
  contentReady: manifest.groups.filter((item) => item.contentReady).length,
  blockedBySource: manifest.groups.filter((item) => !item.contentReady).length,
  blockingWarnings: [...new Set(manifest.groups.flatMap((item) => item.blockingWarnings))].sort(),
  productionAuthorized: false,
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('IZHGMU_MEDICINE1_DRYRUN_READINESS', JSON.stringify(manifest.summary));
