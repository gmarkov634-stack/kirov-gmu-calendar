import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("production server wires one managed VK token manager into OAuth, wall and control handlers", () => {
  assert.match(source, /const vkTokenVault = new VkTokenVault\(config\);/);
  assert.match(source, /const vkTokenManager = new VkTokenManager\(\{ vault: vkTokenVault \}\);/);
  assert.match(source, /createVkOauthCallbackHandler\(process\.env, \{ tokenManager: vkTokenManager \}\)/);
  assert.match(source, /createVkWallHandler\(process\.env, \{ tokenManager: vkTokenManager \}\)/);
  assert.match(source, /createVkControlHandler\(process\.env, \{ tokenManager: vkTokenManager \}\)/);
});
