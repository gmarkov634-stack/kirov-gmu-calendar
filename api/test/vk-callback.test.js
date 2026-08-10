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
  VK_ACCESS_TOKEN: "vk1-test-token",
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

test("ordinary incoming message does not trigger a reply", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
  })(
    fakeRequest({
      type: "message_new",
      group_id: 191574528,
      secret: "test-secret",
      event_id: "event-2",
      object: { message: { peer_id: 123, text: "Здравствуйте" } },
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(fetchCalls, 0);
});

test("/calendar-test sends one guarded VK reply", async () => {
  let request = null;
  const response = fakeResponse();
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { response: 42 };
      },
    };
  };

  await createVkCallbackHandler(env, {
    fetchImpl,
    randomIdFactory: () => 7,
  })(
    fakeRequest({
      type: "message_new",
      group_id: 191574528,
      secret: "test-secret",
      event_id: "event-3",
      object: { message: { peer_id: 123, text: " /calendar-test " } },
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(request.url, "https://api.vk.com/method/messages.send");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("access_token"), "vk1-test-token");
  assert.equal(request.options.body.get("v"), "5.199");
  assert.equal(request.options.body.get("peer_id"), "123");
  assert.equal(request.options.body.get("random_id"), "7");
  assert.equal(request.options.body.get("message"), "calendar-api подключён ✅");
});

test("VK API failure is logged but callback still returns ok to avoid duplicate retries", async () => {
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { error: { error_code: 5 } };
      },
    }),
    randomIdFactory: () => 8,
  })(
    fakeRequest({
      type: "message_new",
      group_id: 191574528,
      secret: "test-secret",
      event_id: "event-4",
      object: { message: { peer_id: 123, text: "/calendar-test" } },
    }),
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
