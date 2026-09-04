import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const BUILD_TARGETS = [
  { name: 'production landing', script: 'deploy/build-landing.sh' },
  { name: 'GitHub Pages', script: 'deploy/build-pages.sh' }
];

for (const { name, script } of BUILD_TARGETS) {
  test(`${name} artifact temporarily bypasses persistent browser binding while preserving trial API contract`, () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'kgmu-browser-trial-'));
    const output = join(tempRoot, 'site');

    try {
      const result = spawnSync('sh', [script, output], {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const runtimeConfig = readFileSync(join(output, 'runtime-config.js'), 'utf8');
      assert.match(runtimeConfig, /trialEnabled:\s*true/);
      assert.match(runtimeConfig, /trialBrowserBindingEnabled:\s*false/);
      assert.match(runtimeConfig, /X-Trial-Browser-Id/);
      assert.match(runtimeConfig, /crypto\?\.randomUUID/);
      assert.match(runtimeConfig, /trialBrowserBindingEnabled !== true/);
      assert.match(runtimeConfig, /return createBrowserId\(\)\.toLowerCase\(\)/);
      assert.match(runtimeConfig, /function persistentBrowserId\(\)/);
      assert.match(runtimeConfig, /localStorage\.getItem\(STORAGE_KEY\)/);
      assert.match(runtimeConfig, /localStorage\.setItem\(STORAGE_KEY, memoryBrowserId\)/);
      assert.match(runtimeConfig, /pathname\.endsWith\("\/trial"\)/);
      assert.match(runtimeConfig, /method !== "POST"/);
      assert.doesNotMatch(runtimeConfig, /pathname\.endsWith\("\/checkout"\).*X-Trial-Browser-Id/s);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}
