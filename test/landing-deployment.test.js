import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production landing config enables only current Product MVP surfaces', () => {
  const config = read('deploy/runtime-config.production.js');
  assert.match(config, /apiBase:\s*""/);
  assert.match(config, /trialEnabled:\s*true/);
  assert.match(config, /managementEnabled:\s*true/);
  assert.match(config, /checkoutEnabled:\s*false/);
  assert.match(config, /universityId:\s*"kirov-gmu"/);
  assert.match(config, /academicYearId:\s*"2026-2027"/);
  assert.doesNotMatch(config, /sslip\.io|containerapps\.ru|https?:\/\//);
});

test('nginx template keeps landing and core on one origin with sanitized proxy identity', () => {
  const nginx = read('deploy/nginx/kirov-gmu-site.conf.template');

  assert.match(nginx, /server_name __KGMU_HOST__;/);
  assert.match(nginx, /root __KGMU_STATIC_ROOT__;/);
  assert.match(nginx, /location = \/trial/);
  assert.match(nginx, /location \^~ \/management\//);
  assert.match(nginx, /location \^~ \/c\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /proxy_set_header X-Real-IP \$remote_addr;/);
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
  assert.match(nginx, /access_log off;/);
  assert.match(nginx, /Cache-Control "no-store"/);
  assert.match(nginx, /Referrer-Policy "no-referrer"/);
  assert.doesNotMatch(nginx, /sslip\.io|containerapps\.ru/);
});

test('artifact builder produces a deployable artifact and rejects legacy runtime references', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'kgmu-landing-'));
  const output = join(tempRoot, 'site');

  try {
    const result = spawnSync('sh', ['deploy/build-landing.sh', output], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), output);

    assert.ok(existsSync(join(output, 'index.html')));
    assert.ok(existsSync(join(output, 'manage', 'index.html')));
    assert.ok(existsSync(join(output, 'catalog', '2026-2027-semester-1.json')));
    assert.equal(existsSync(join(output, 'README.md')), false);

    const runtimeConfig = readFileSync(join(output, 'runtime-config.js'), 'utf8');
    assert.match(runtimeConfig, /trialEnabled:\s*true/);
    assert.match(runtimeConfig, /managementEnabled:\s*true/);
    assert.match(runtimeConfig, /checkoutEnabled:\s*false/);

    const combinedRuntime = [
      readFileSync(join(output, 'index.html'), 'utf8'),
      readFileSync(join(output, 'app.js'), 'utf8'),
      readFileSync(join(output, 'runtime-config.js'), 'utf8')
    ].join('\n');
    assert.doesNotMatch(combinedRuntime, /containerapps\.ru|\/api\/v2|file:\/\/\//);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('deployment documentation keeps secrets and live mutations outside Git', () => {
  const docs = read('deploy/README.md');

  assert.match(docs, /RESEND_API_KEY=<runtime secret only>/);
  assert.match(docs, /Do not replace origins belonging to other universities/);
  assert.match(docs, /overwrites `X-Forwarded-For` with `\$remote_addr`/);
  assert.match(docs, /does not perform production deployment/);
  assert.match(docs, /back up the live SQLite database/);
});
