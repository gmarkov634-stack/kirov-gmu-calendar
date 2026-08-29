import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pages runtime enables trial, management, and checkout after controlled commerce E2E', () => {
  const config = read('deploy/runtime-config.pages.js');
  assert.match(config, /apiBase:\s*"https:\/\/176-123-165-120\.sslip\.io"/);
  assert.match(config, /catalogUrl:\s*"\.\/catalog\/2026-2027-semester-1\.json"/);
  assert.match(config, /managementSessionTransport:\s*"bearer"/);
  assert.match(config, /trialEnabled:\s*true/);
  assert.match(config, /managementEnabled:\s*true/);
  assert.match(config, /checkoutEnabled:\s*true/);
});

test('Pages management client keeps bearer credential in memory only', () => {
  const client = read('landing/manage/manage.js');
  assert.match(client, /let managementToken = null;/);
  assert.match(client, /headers\.Authorization = `Bearer \$\{managementToken\}`/);
  assert.match(client, /credentials: usesBearerSession\(\) \? "omit" : "include"/);
  assert.match(client, /managementToken = payload\.managementToken/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|document\.cookie/);
});

test('Pages artifact builder preserves the landing and project-relative catalog', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'kgmu-pages-'));
  const output = join(tempRoot, 'site');

  try {
    const result = spawnSync('sh', ['deploy/build-pages.sh', output], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(output, 'index.html')));
    assert.ok(existsSync(join(output, 'manage', 'index.html')));
    assert.ok(existsSync(join(output, 'catalog', '2026-2027-semester-1.json')));
    assert.ok(existsSync(join(output, '.nojekyll')));
    assert.equal(existsSync(join(output, 'README.md')), false);

    const runtimeConfig = readFileSync(join(output, 'runtime-config.js'), 'utf8');
    assert.match(runtimeConfig, /managementSessionTransport:\s*"bearer"/);
    assert.match(runtimeConfig, /trialEnabled:\s*true/);
    assert.match(runtimeConfig, /managementEnabled:\s*true/);
    assert.match(runtimeConfig, /checkoutEnabled:\s*true/);
    assert.doesNotMatch(runtimeConfig, /containerapps\.ru|\/api\/v2|file:\/\/\//);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Pages workflow is manual-only and cannot publish merely because code is merged', () => {
  const workflow = read('.github/workflows/pages.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /push:/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test('Pages documentation records exact browser Origin and project-site management URL', () => {
  const docs = read('deploy/PAGES.md');
  assert.match(docs, /https:\/\/gmarkov634-stack\.github\.io\/kirov-gmu-calendar\//);
  assert.match(docs, /exactly:\n\n`https:\/\/gmarkov634-stack\.github\.io`/);
  assert.match(docs, /MEDICAL_CALENDAR_MANAGEMENT_SESSION_TRANSPORT=bearer/);
  assert.match(docs, /github\.io` cannot be used as the project's sending domain/);
  assert.match(docs, /Yandex SMTP/);
});
