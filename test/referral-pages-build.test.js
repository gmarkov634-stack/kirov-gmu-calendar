import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const buildScript = new URL('../deploy/build-pages.sh', import.meta.url);
const pagesConfig = new URL('../deploy/runtime-config.pages.js', import.meta.url);

test('Pages build wires referral sharing into landing and management without enabling analytics', async () => {
  const [build, config] = await Promise.all([
    readFile(buildScript, 'utf8'),
    readFile(pagesConfig, 'utf8')
  ]);

  assert.match(build, /\.\/referral-sharing\.js/);
  assert.match(build, /\.\/referral-platform-sharing\.js/);
  assert.match(build, /\.\.\/referral-sharing\.js/);
  assert.match(build, /\.\.\/referral-platform-sharing\.js/);
  assert.match(config, /referralAnalyticsEnabled:\s*false/);
  assert.doesNotMatch(config, /referralAnalyticsEnabled:\s*true/);
});
