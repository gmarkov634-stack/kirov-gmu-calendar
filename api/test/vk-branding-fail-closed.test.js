import assert from "node:assert/strict";
import test from "node:test";
import { createVkControlHandler } from "../src/vk-control.js";

const now = Date.parse("2026-08-16T22:35:00.000Z");

function fakeRequest(action) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-oidc" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        id: `fail-closed-${action.replaceAll(".", "-")}-0001`,
        action,
        createdAt: "2026-08-16T22:34:00.000Z",
        payload: {
          sourceUrl: "https://raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/main/ops/vk/assets/group-avatar-independent-20260816.jpg",
        },
      }));
    },
  };
}

function fakeResponse() {
  return {
    statusCode: null,
    body: "",
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = "") { this.body = String(body); },
  };
}

for (const action of ["group.cover.set", "group.avatar.set"]) {
  test(`${action} returns 501 before credential access or VK fetch`, async () => {
    let managedTokenCalls = 0;
    let fetchCalls = 0;
    const response = fakeResponse();
    const handler = createVkControlHandler({
      VK_CALLBACK_GROUP_ID: "191574528",
      VK_ACCESS_TOKEN: "community-token-must-not-be-used",
      VK_USER_ACCESS_TOKEN: "legacy-user-token-must-not-be-used",
      VK_API_VERSION: "5.199",
    }, {
      nowFactory: () => now,
      verifyOidcToken: async () => ({}),
      tokenManager: {
        configured: true,
        async getAccessToken() {
          managedTokenCalls += 1;
          return "managed-user-token-must-not-be-used";
        },
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("network must not be used");
      },
    });

    await handler(fakeRequest(action), response);

    assert.equal(response.statusCode, 501);
    assert.deepEqual(JSON.parse(response.body), { error: "vk_group_branding_not_supported" });
    assert.equal(managedTokenCalls, 0);
    assert.equal(fetchCalls, 0);
  });
}
