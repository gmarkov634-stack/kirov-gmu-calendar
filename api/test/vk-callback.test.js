import assert from "node:assert/strict";
import test from "node:test";
import { createVkCallbackHandler } from "../src/vk-callback.js";

function fakeRequest(body) {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}

const env = {
  VK_CALLBACK_GROUP_ID: "191574528",
  VK_CALLBACK_CONFIRMATION_CODE: "confirmation-code",
  VK_CALLBACK_SECRET: "test-secret",
};

test("VK confirmation returns configured confirmation code", async () => {
  const response = fakeResponse();
  await createVkCallbackHandler(env)(
    fakeRequest({ type: "confirmation", group_id: 191574528 }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "confirmation-code");
});

test("VK event with valid secret returns ok", async () => {
  const response = fakeResponse();
  await createVkCallbackHandler(env)(
    fakeRequest({ type: "message_new", group_id: 191574528, secret: "test-secret", event_id: "event-1" }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
});

test("VK event with invalid secret is rejected", async () => {
  const response = fakeResponse();
  await createVkCallbackHandler(env)(
    fakeRequest({ type: "message_new", group_id: 191574528, secret: "wrong-secret" }),
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body, "forbidden");
});
