import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operatorUrl = new URL('../ops/vk-publisher/medical-calendar-vk-ops', import.meta.url);
const sudoersUrl = new URL('../ops/vk-publisher/medical-calendar-vk-ops.sudoers', import.meta.url);
const installerUrl = new URL('../ops/vk-publisher/install.sh', import.meta.url);

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

test('VK production operator exposes only the first reviewed KGMU text operations', async () => {
  const source = await text(operatorUrl);
  assert.match(source, /ALLOWED_OPERATIONS = \{"list", "publish", "edit", "delete"\}/);
  assert.match(source, /groups\.getById/);
  assert.match(source, /wall\.get/);
  assert.match(source, /wall\.post/);
  assert.match(source, /wall\.edit/);
  assert.match(source, /wall\.delete/);
  assert.match(source, /MAX_REQUEST_BYTES = 32_768/);
  assert.match(source, /MAX_MESSAGE_CHARS = 8_192/);
  assert.match(source, /CONFIG_PATH = "\/etc\/medical-calendar\/vk\/kirov-gmu\.json"/);
});

test('sudo boundary permits only exact VK operator subcommands', async () => {
  const source = (await text(sudoersUrl)).trim();
  assert.equal(
    source,
    'ghrunner-medcal ALL=(root) NOPASSWD: /usr/local/sbin/medical-calendar-vk-ops list, /usr/local/sbin/medical-calendar-vk-ops publish, /usr/local/sbin/medical-calendar-vk-ops edit, /usr/local/sbin/medical-calendar-vk-ops delete'
  );
  assert.doesNotMatch(source, /\*/);
  assert.doesNotMatch(source, /\/bin\/(?:sh|bash)/);
});

test('installer does not restart or replace the calendar runtime', async () => {
  const source = await text(installerUrl);
  assert.match(source, /VK_OPERATOR_INSTALLED=ok/);
  assert.match(source, /CALENDAR_SERVICE_RESTARTED=no/);
  assert.match(source, /visudo -cf/);
  assert.doesNotMatch(source, /systemctl\s+(?:restart|stop|disable)/);
  assert.doesNotMatch(source, /\/opt\/medical-calendar-core/);
  assert.doesNotMatch(source, /runtime\.sqlite/);
});
