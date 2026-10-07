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

test('Dentistry course 1 current revision is not an approved publication candidate', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/dentistry-191-194.source.json'),
    readJson('../fixtures/2026-2027-semester-1/normalized/dentistry-191-194.normalized.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.qa-report.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json')
  ]);

  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(draft.status, 'REVIEW_REQUIRED');
  assert.equal(draft.events.length, 1651);
  assert.equal(qa.decision, 'review-required');
  assert.equal(qa.readyForScheduleVersion, false);
  assert.equal(qa.unresolvedSemanticItemCount, 1);
  assert.equal(publication.lifecycleStatus, 'SUPERSEDED_SOURCE_REVISION');
  assert.equal(publication.publicationAllowed, false);
  assert.equal(publication.currentSourceSha256, source.source.sha256);
  assert.notEqual(publication.sourceSha256, source.source.sha256);
});

test('Dentistry course 1 publication preflight fails closed before any database work', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--preflight']),
    (error) => {
      assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /publication blocked by source lifecycle: semantic-review-required/);
      return true;
    }
  );
});

test('Dentistry course 1 apply is blocked by source lifecycle before runtime import', async () => {
  const script = fileURLToPath(new URL('../ops/publish-dentistry-191-194.mjs', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--apply']),
    (error) => {
      assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, /publication blocked by source lifecycle: semantic-review-required/);
      return true;
    }
  );
});
