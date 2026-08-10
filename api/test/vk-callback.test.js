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

function scheduleStore(groupSets = {}) {
  return {
    async listScheduleGroups({ university, program, course }) {
      assert.equal(university, "kgmu");
      return groupSets[`${program}:${course}`] || [];
    },
  };
}

const pediatricsGroups = [
  { groupId: "kgmu:pediatrics:1:131", groupCode: "131", displayName: "Группа 131" },
  { groupId: "kgmu:pediatrics:1:132", groupCode: "132", displayName: "Группа 132" },
  { groupId: "kgmu:pediatrics:1:139", groupCode: "139", displayName: "Группа 139" },
];

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
  const menu = JSON.parse(body.get("keyboard"));
  assert.equal(menu.buttons[0][0].action.label, "Получить расписание");
});

test("Получить расписание sends program selection keyboard", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 9,
  })(fakeRequest(callbackEvent("Получить расписание", "event-schedule")), response);

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

  const menu = JSON.parse(requests[0].options.body.get("keyboard"));
  const courseButtons = menu.buttons.flat().filter((button) => /курс$/.test(button.action.label));
  assert.deepEqual(courseButtons.map((button) => button.action.label), [
    "1 курс", "2 курс", "3 курс", "4 курс", "5 курс", "6 курс",
  ]);
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

test("course selection shows only groups published for that program and course", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 12,
    store: scheduleStore({ "pediatrics:1": pediatricsGroups }),
  })(
    fakeRequest(callbackEvent(
      "1 курс",
      "event-course-groups",
      { action: "course", program: "pediatrics", course: 1 },
    )),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(requests.length, 1);
  const body = requests[0].options.body;
  assert.match(body.get("message"), /Педиатрия · 1 курс/);
  assert.match(body.get("message"), /Выберите группу/);

  const menu = JSON.parse(body.get("keyboard"));
  const labels = menu.buttons.flat().map((button) => button.action.label);
  assert.deepEqual(labels.slice(0, 3), ["131", "132", "139"]);
  const groupPayload = JSON.parse(menu.buttons[0][1].action.payload);
  assert.deepEqual(groupPayload, {
    action: "group",
    program: "pediatrics",
    course: 1,
    groupId: "kgmu:pediatrics:1:132",
  });
});

test("course selection does not invent groups when schedule is not published", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 13,
    store: scheduleStore(),
  })(
    fakeRequest(callbackEvent(
      "2 курс",
      "event-course-empty",
      { action: "course", program: "medicine", course: 2 },
    )),
    response,
  );

  const body = requests[0].options.body;
  assert.match(body.get("message"), /Расписание для этого курса пока не опубликовано/);
  const menu = JSON.parse(body.get("keyboard"));
  const labels = menu.buttons.flat().map((button) => button.action.label);
  assert.deepEqual(labels, ["← К курсам", "← Выбрать направление"]);
});

test("published group payload is revalidated and confirms selected group", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 14,
    store: scheduleStore({ "pediatrics:1": pediatricsGroups }),
  })(
    fakeRequest(callbackEvent(
      "132",
      "event-group",
      {
        action: "group",
        program: "pediatrics",
        course: 1,
        groupId: "kgmu:pediatrics:1:132",
      },
    )),
    response,
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0].options.body.get("message"), /Педиатрия · 1 курс · группа 132/);
  assert.match(requests[0].options.body.get("message"), /Следующий шаг — оформление календаря/);
});

test("forged unpublished group payload is ignored", async () => {
  let fetchCalls = 0;
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    },
    store: scheduleStore({ "pediatrics:1": pediatricsGroups }),
  })(
    fakeRequest(callbackEvent(
      "999",
      "event-group-forged",
      {
        action: "group",
        program: "pediatrics",
        course: 1,
        groupId: "kgmu:pediatrics:1:999",
      },
    )),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
  assert.equal(fetchCalls, 0);
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

test("back to courses preserves program context", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 15,
  })(
    fakeRequest(callbackEvent(
      "← К курсам",
      "event-back-courses",
      { action: "back_courses", program: "pediatrics" },
    )),
    response,
  );

  assert.match(requests[0].options.body.get("message"), /Педиатрия/);
  assert.match(requests[0].options.body.get("message"), /Выберите курс/);
});

test("back button returns to program selection", async () => {
  const requests = [];
  const response = fakeResponse();
  await createVkCallbackHandler(env, {
    fetchImpl: successfulVkFetch(requests),
    randomIdFactory: () => 16,
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
    randomIdFactory: () => 17,
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
