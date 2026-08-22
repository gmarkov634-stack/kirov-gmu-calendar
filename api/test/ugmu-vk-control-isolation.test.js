import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createVkControlTenantEnv } from "../src/vk-control-tenant-env.js";

test("UGMU VK tenant env never falls back to KGMU, OmGMU or IzhGMU credentials", () => {
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
    UGMU_VK_ACCESS_TOKEN: "ugmu-community",
    UGMU_VK_USER_ACCESS_TOKEN: "ugmu-user",
    UGMU_VK_CALLBACK_GROUP_ID: "444",
    VK_API_VERSION: "5.199",
  };

  assert.deepEqual(createVkControlTenantEnv(env, "UGMU"), {
    VK_CALLBACK_GROUP_ID: "444",
    VK_ACCESS_TOKEN: "ugmu-community",
    VK_USER_ACCESS_TOKEN: "ugmu-user",
    VK_API_VERSION: "5.199",
  });

  const missingUgmu = createVkControlTenantEnv({
    ...env,
    UGMU_VK_ACCESS_TOKEN: "",
    UGMU_VK_USER_ACCESS_TOKEN: "",
    UGMU_VK_CALLBACK_GROUP_ID: "",
  }, "UGMU");
  assert.equal(missingUgmu.VK_ACCESS_TOKEN, "");
  assert.equal(missingUgmu.VK_USER_ACCESS_TOKEN, "");
  assert.equal(missingUgmu.VK_CALLBACK_GROUP_ID, "");
});

test("UGMU VK control has its own backend route and workflow", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../../.github/workflows/ugmu-vk-control.yml", import.meta.url), "utf8");

  assert.match(server, /createVkControlTenantEnv\(process\.env, "UGMU"\)/);
  assert.match(server, /\/api\/v1\/vk\/ugmu\/control/);
  assert.match(workflow, /ops\/vk\/ugmu\/command\.json/);
  assert.match(workflow, /\/api\/v1\/vk\/ugmu\/control/);
  assert.doesNotMatch(workflow, /ops\/vk\/(?:omgmu|izhgmu)\/command\.json/);
});
