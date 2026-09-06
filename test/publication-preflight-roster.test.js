import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('current publication preflight gate discovers publisher entrypoints and isolates production environment', async () => {
  const [script, packageJson] = await Promise.all([
    source('ops/preflight-current-publications.mjs'),
    source('package.json')
  ]);

  assert.match(script, /PUBLISHER_PATTERN/);
  assert.match(script, /medicine\|pediatrics\|dentistry/);
  assert.match(script, /publish-medicine-101-110\.mjs/);
  assert.match(script, /historical group-102 correction migration/);
  assert.match(script, /delete preflightEnv\.MEDICAL_CALENDAR_DB_PATH/);
  assert.match(script, /delete preflightEnv\.MEDICAL_CALENDAR_CORE_ROOT/);
  assert.match(script, /--preflight/);
  assert.match(script, /CURRENT_PUBLICATION_PREFLIGHTS_OK/);

  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['preflight:publications'], 'node ops/preflight-current-publications.mjs');
  assert.match(parsed.scripts.check, /npm run preflight:publications/);
});
