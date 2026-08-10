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

function callbackEvent(text, eventId = "event-1", payload = null) {
  const message = { peer_id: 123, text };
  if (payload) message.payload = JSON.stringify(payload);
  return {
    type: "message_new",
    group_id: 191574528,
    secret: "test-secret",
    event_id: eventId,
    object: { message },
  };
}

function successfulVkFetch(requests) {
  return async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { response: requests.length };
      },
    };
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

test("ordinary incoming message does not trigger a reply", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
  })(fakeRequest(callbackEvent("Здравствуйте")), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(fetchCalls, 0);
});

test("/calendar-test keeps the guarded connection test", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 7,
  })(fakeRequest(callbackEvent(" /calendar-test ")), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.vk.com/method/messages.send");
  assert.equal(requests[0].options.body.get("message"), "calendar-api подключён ✅");
  assert.equal(requests[0].options.body.get("keyboard"), null);
});

test("начать sends welcome text with Get schedule keyboard", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 8,
  })(fakeRequest(callbackEvent("  Начать  ", "event-start")), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);

  const body = requests[0].options.body;
  assert.match(body.get("message"), /Добро пожаловать/);
  assert.match(body.get("message"), /Получить расписание/);
  const menu = JSON.parse(body.get("keyboard"));
  assert.equal(menu.one_time, false);
  assert.equal(menu.inline, false);
  assert.equal(menu.buttons[0][0].action.type, "text");
  assert.equal(menu.buttons[0][0].action.label, "Получить расписание");
});

test("Получить расписание sends program selection keyboard", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 9,
  })(fakeRequest(callbackEvent("Получить расписание", "event-schedule")), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);

  const body = requests[0].options.body;
  assert.match(body.get("message"), /Выберите направление подготовки/);
  const menu = JSON.parse(body.get("keyboard"));
  const labels = menu.buttons.flat().map((button) => button.action.label);
  assert.deepEqual(labels, [
    "Лечебное дело",
    "Педиатрия",
    "Стоматология",
    "Медицинская биохимия",
  ]);
});

test("pediatrics program button sends six course buttons", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 10,
  })(
    fakeRequest(callbackEvent(
      "Педиатрия",
      "event-program-pediatrics",
      { action: "program", program: "pediatrics" },
    )),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);
  const body = requests[0].options.body;
  assert.match(body.get("message"), /Педиатрия/);
  assert.match(body.get("message"), /Выберите курс/);

  const menu = JSON.parse(body.get("keyboard"));
  const courseButtons = menu.buttons.flat().filter((button) => /курс$/.test(button.action.label));
  assert.deepEqual(courseButtons.map((button) => button.action.label), [
    "1 курс", "2 курс", "3 курс", "4 курс", "5 курс", "6 курс",
  ]);
  const sixthPayload = JSON.parse(courseButtons[5].action.payload);
  assert.deepEqual(sixthPayload, { action: "course", program: "pediatrics", course: 6 });
});

test("dentistry program button sends five course buttons", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 11,
  })(
    fakeRequest(callbackEvent(
      "Стоматология",
      "event-program-dentistry",
      { action: "program", program: "dentistry" },
    )),
    response,
  );

  const menu = JSON.parse(requests[0].options.body.get("keyboard"));
  const labels = menu.buttons.flat().map((button) => button.action.label);
  assert.deepEqual(labels.slice(0, 5), ["1 курс", "2 курс", "3 курс", "4 курс", "5 курс"]);
  assert.equal(labels.includes("6 курс"), false);
});

test("course payload preserves program context without server-side session", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 12,
  })(
    fakeRequest(callbackEvent(
      "2 курс",
      "event-course",
      { action: "course", program: "medicine", course: 2 },
    )),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);
  const body = requests[0].options.body;
  assert.match(body.get("message"), /Лечебное дело · 2 курс/);
  assert.match(body.get("message"), /Следующий шаг — выбор группы/);
});

test("typed course without payload is ignored because it has no program context", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
  })(fakeRequest(callbackEvent("2 курс", "event-course-no-payload")), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(fetchCalls, 0);
});

test("back button returns to program selection", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 13,
  })(
    fakeRequest(callbackEvent(
      "← Выбрать направление",
      "event-back",
      { action: "back_programs" },
    )),
    response,
  );

  assert.match(requests[0].options.body.get("message"), /Выберите направление подготовки/);
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
    randomIdFactory: () => 14,
  })(fakeRequest(callbackEvent("начать", "event-error")), response);

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
