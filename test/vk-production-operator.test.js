import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operatorUrl = new URL('../ops/vk-publisher/medical-calendar-vk-ops', import.meta.url);
const statusUrl = new URL('../ops/vk-publisher/medical-calendar-vk-status', import.meta.url);
const sudoersUrl = new URL('../ops/vk-publisher/medical-calendar-vk-ops.sudoers', import.meta.url);
const installerUrl = new URL('../ops/vk-publisher/install.sh', import.meta.url);
const configUrl = new URL('../config/vk.json', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('VK production operator is root-gated and resolves the token only through Cloud.ru Secret Management', async () => {
  const source = await text(operatorUrl);
  assert.match(source, /os\.geteuid\(\) != 0/);
  assert.match(source, /CLOUDRU_DIR = "\/etc\/medical-calendar\/cloudru"/);
  assert.match(source, /f"\{CLOUDRU_DIR\}\/key-id"/);
  assert.match(source, /f"\{CLOUDRU_DIR\}\/key-secret"/);
  assert.match(source, /secretmanager-product-instance-id/);
  assert.match(source, /https:\/\/iam\.api\.cloud\.ru\/api\/v1\/auth\/token/);
  assert.match(source, /https:\/\/secretmanager\.api\.cloud\.ru\/v1/);
  assert.match(source, /Authorization.*Bearer/);
  assert.doesNotMatch(source, /vk1\.[A-Za-z0-9_-]+/);
});

test('VK production operator keeps reviewed text write operations while readback is separated', async () => {
  const source = await text(operatorUrl);
  assert.match(source, /ALLOWED_OPERATIONS = \{"list", "publish", "edit", "delete"\}/);
  assert.match(source, /groups\.getById/);
  assert.match(source, /wall\.post/);
  assert.match(source, /wall\.edit/);
  assert.match(source, /wall\.delete/);
  assert.match(source, /MAX_REQUEST_BYTES = 32_768/);
  assert.match(source, /MAX_MESSAGE_CHARS = 8_192/);
  assert.match(source, /CONFIG_PATH = "\/etc\/medical-calendar\/vk\/kirov-gmu\.json"/);
});

test('read-only VK status verifies community token permissions without wall.get', async () => {
  const source = await text(statusUrl);
  assert.match(source, /medical-calendar-vk-ops/);
  assert.match(source, /groups\.getTokenPermissions/);
  assert.match(source, /community_token_wall_get_unsupported/);
  assert.match(source, /"wall" not in names/);
  assert.doesNotMatch(source, /wall\.get/);
});

test('VK config reports community-token readback limitation explicitly', async () => {
  const config = JSON.parse(await text(configUrl));
  assert.equal(config.capabilities.publishText, true);
  assert.equal(config.capabilities.listRecentPosts, false);
  assert.equal(config.capabilities.readOnlyStatus, true);
  assert.equal(config.capabilities.editPosts, true);
  assert.equal(config.capabilities.deletePosts, true);
});

test('sudo boundary permits exact status and write commands only', async () => {
  const source = (await text(sudoersUrl)).trim();
  assert.equal(
    source,
    'ghrunner-medcal ALL=(root) NOPASSWD: /usr/local/sbin/medical-calendar-vk-status, /usr/local/sbin/medical-calendar-vk-ops publish, /usr/local/sbin/medical-calendar-vk-ops edit, /usr/local/sbin/medical-calendar-vk-ops delete'
  );
  assert.doesNotMatch(source, /medical-calendar-vk-ops list/);
  assert.doesNotMatch(source, /\*/);
  assert.doesNotMatch(source, /\/bin\/(?:sh|bash)/);
});

test('installer does not restart or replace the calendar runtime', async () => {
  const source = await text(installerUrl);
  assert.match(source, /VK_OPERATOR_INSTALLED=ok/);
  assert.match(source, /CALENDAR_SERVICE_RESTARTED=no/);
  assert.match(source, /TARGET_STATUS='\/usr\/local\/sbin\/medical-calendar-vk-status'/);
  assert.match(source, /python3 -m py_compile "\$TARGET_OPERATOR" "\$TARGET_STATUS"/);
  assert.match(source, /visudo -cf/);
  assert.doesNotMatch(source, /systemctl\s+(?:restart|stop|disable)/);
  assert.doesNotMatch(source, /\/opt\/medical-calendar-core/);
  assert.doesNotMatch(source, /runtime\.sqlite/);
});
