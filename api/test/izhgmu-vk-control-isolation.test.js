import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createVkControlTenantEnv } from "../src/vk-control-tenant-env.js";

test("IzhGMU VK tenant env never falls back to KGMU or OmGMU credentials", () => {
  const env = {
    VK_ACCESS_TOKEN: "kgmu-community",
    VK_USER_ACCESS_TOKEN: "kgmu-user",
    VK_CALLBACK_GROUP_ID: "111",
    OMGMU_VK_ACCESS_TOKEN: "omgmu-community",
    OMGMU_VK_USER_ACCESS_TOKEN: "omgmu-user",
    OMGMU_VK_CALLBACK_GROUP_ID: "222",
    IZHGMU_VK_ACCESS_TOKEN: "izh-community",
    IZHGMU_VK_USER_ACCESS_TOKEN: "izh-user",
    IZHGMU_VK_CALLBACK_GROUP_ID: "333",
    VK_API_VERSION: "5.199",
  };

  assert.deepEqual(createVkControlTenantEnv(env, "IZHGMU"), {
    VK_CALLBACK_GROUP_ID: "333",
    VK_ACCESS_TOKEN: "izh-community",
    VK_USER_ACCESS_TOKEN: "izh-user",
    VK_API_VERSION: "5.199",
  });

  const missingIzh = createVkControlTenantEnv({
    ...env,
    IZHGMU_VK_ACCESS_TOKEN: "",
    IZHGMU_VK_USER_ACCESS_TOKEN: "",
    IZHGMU_VK_CALLBACK_GROUP_ID: "",
  }, "IZHGMU");
  assert.equal(missingIzh.VK_ACCESS_TOKEN, "");
  assert.equal(missingIzh.VK_USER_ACCESS_TOKEN, "");
  assert.equal(missingIzh.VK_CALLBACK_GROUP_ID, "");
});

test("IzhGMU VK control has its own backend route and workflow", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../../.github/workflows/izhgmu-vk-control.yml", import.meta.url), "utf8");

  assert.match(server, /createVkControlTenantEnv\(process\.env, "IZHGMU"\)/);
  assert.match(server, /\/api\/v1\/vk\/izhgmu\/control/);
  assert.match(workflow, /ops\/vk\/izhgmu\/command\.json/);
  assert.match(workflow, /\/api\/v1\/vk\/izhgmu\/control/);
  assert.doesNotMatch(workflow, /ops\/vk\/omgmu\/command\.json/);
});
