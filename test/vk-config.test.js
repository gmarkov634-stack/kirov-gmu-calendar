import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../config/vk.json', import.meta.url);

async function loadConfig() {
  return JSON.parse(await readFile(configUrl, 'utf8'));
}

test('KGMU VK configuration pins only non-secret community metadata', async () => {
  const config = await loadConfig();
  assert.equal(config.schemaVersion, 'v1');
  assert.equal(config.community.screenName, 'calendarksmu');
  assert.equal(config.community.publicUrl, 'https://vk.ru/calendarksmu');
  assert.equal(config.secretReference.provider, 'cloud.ru-secret-management');
  assert.equal(config.secretReference.path, 'vk/kirov-gmu-community-access-token');

  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /access[_-]?token\s*[:=]\s*["'][^"']+/i);
  assert.doesNotMatch(serialized, /vk1\./i);
});

test('configuration advertises capabilities actually supported by the community-token transport', async () => {
  const config = await loadConfig();
  assert.deepEqual(config.capabilities, {
    publishText: true,
    listRecentPosts: false,
    readOnlyStatus: true,
    editPosts: true,
    deletePosts: true,
    publishPhotos: false
  });
});
