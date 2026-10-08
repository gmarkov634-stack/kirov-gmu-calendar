import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('Dentistry course 1 semantic QA pass is still not an approved publication candidate', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/dentistry-191-194.source.json'),
    readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191-194.normalized.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json')
  ]);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-review-required');
  assert.equal(draft.status, 'NORMALIZED');
  assert.equal(draft.events.length, 1669);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.readyForScheduleVersion, true);
  assert.equal(qa.unresolvedSemanticItemCount, 0);
  assert.equal(qa.publicationAllowed, false);
  assert.equal(publication.lifecycleStatus, 'SUPERSEDED_SOURCE_REVISION');
  assert.equal(publication.publicationAllowed, false);
  assert.equal(publication.currentSourceSha256, source.source.sha256);
  assert.notEqual(publication.sourceSha256, source.source.sha256);
});

test('Dentistry course 1 publication preflight remains blocked by platform lifecycle', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--preflight']),
    (error) => {
      assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /publication blocked by source lifecycle: semantic-qa-pass-platform-review-required/);
      return true;
    }
  );
});

test('Dentistry course 1 apply is blocked before runtime import', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--apply']),
    (error) => {
      assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /publication blocked by source lifecycle: semantic-qa-pass-platform-review-required/);
      return true;
    }
  );
});
