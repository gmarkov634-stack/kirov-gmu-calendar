import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createVkControlTenantEnv } from "../src/vk-control-tenant-env.js";

test("OmGMU VK control environment is isolated from legacy KGMU credentials", () => {
  const scoped = createVkControlTenantEnv({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "kgmu-community-token",
    VK_USER_ACCESS_TOKEN: "kgmu-user-token",
    VK_API_VERSION: "5.199",
    OMGMU_VK_CALLBACK_GROUP_ID: "222222222",
    OMGMU_VK_ACCESS_TOKEN: "omgmu-community-token",
    OMGMU_VK_USER_ACCESS_TOKEN: "omgmu-user-token",
  }, "OMGMU");

  assert.deepEqual(scoped, {
    VK_CALLBACK_GROUP_ID: "222222222",
    VK_ACCESS_TOKEN: "omgmu-community-token",
    VK_USER_ACCESS_TOKEN: "omgmu-user-token",
    VK_API_VERSION: "5.199",
  });
});

test("OmGMU VK control never falls back to KGMU tokens or group id", () => {
  const scoped = createVkControlTenantEnv({
    VK_CALLBACK_GROUP_ID: "191574528",
    VK_ACCESS_TOKEN: "kgmu-community-token",
    VK_USER_ACCESS_TOKEN: "kgmu-user-token",
    VK_API_VERSION: "5.199",
  }, "OMGMU");

  assert.equal(scoped.VK_CALLBACK_GROUP_ID, "");
  assert.equal(scoped.VK_ACCESS_TOKEN, "");
  assert.equal(scoped.VK_USER_ACCESS_TOKEN, "");
  assert.equal(scoped.VK_API_VERSION, "5.199");
});

test("production server exposes a dedicated OmGMU VK control route without the KGMU managed token manager", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /createVkControlTenantEnv\(process\.env, "OMGMU"\)/);
  assert.match(source, /createVkControlHandler\(omgmuVkControlEnv\)/);
  assert.match(source, /url\.pathname === "\/api\/v1\/vk\/omgmu\/control"/);
  assert.doesNotMatch(source, /createVkControlHandler\(omgmuVkControlEnv, \{ tokenManager: vkTokenManager \} \)/);
});

test("OmGMU GitHub workflow uses its own command path and control endpoint", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/omgmu-vk-control.yml", import.meta.url), "utf8");

  assert.match(workflow, /ops\/vk\/omgmu\/command\.json/);
  assert.match(workflow, /\/api\/v1\/vk\/omgmu\/control/);
  assert.doesNotMatch(workflow, /--data-binary @ops\/vk\/command\.json/);
});
