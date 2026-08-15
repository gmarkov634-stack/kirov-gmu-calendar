import fs from 'node:fs/promises';
import path from 'node:path';
import { collectIzhgmuMedicine6PostsemesterSources } from '../src/adapters/izhgmu/postsemester-sources.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const outputDir = path.join(inputDir, 'postsemester');
await fs.mkdir(outputDir, { recursive: true });

const report = await collectIzhgmuMedicine6PostsemesterSources();
for (const file of report.files) {
  if (file.status !== 'downloaded' || !file.buffer) continue;
  await fs.writeFile(path.join(outputDir, file.outputFile), file.buffer);
}

const serializable = {
  ...report,
  files: report.files.map(({ buffer, ...file }) => file),
};
await fs.writeFile(
  path.join(inputDir, 'postsemester-report.json'),
  `${JSON.stringify(serializable, null, 2)}\n`,
);

console.log('IZHGMU_POSTSEMESTER', JSON.stringify({
  expectedCount: serializable.expectedCount,
  downloadedCount: serializable.downloadedCount,
  failedCount: serializable.failedCount,
  status: serializable.status,
  streamMappingStatus: serializable.streamMappingPolicy.communicationSkillsStatus,
  streamMappingScope: serializable.streamMappingPolicy.scope,
  files: serializable.files.map((file) => ({
    id: file.id,
    kind: file.kind,
    status: file.status,
    bytes: file.bytes ?? null,
    sha256: file.sha256 ?? null,
    outputFile: file.outputFile,
    calendarAuthority: file.calendarAuthority,
    rangeMarkerFallback: file.rangeMarkerFallback,
  })),
}));

if (serializable.status !== 'ok') process.exitCode = 1;
