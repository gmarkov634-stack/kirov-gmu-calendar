const MAX_BODY_BYTES = 65536;
const TEST_COMMAND = "/calendar-test";
const TEST_REPLY = "calendar-api подключён ✅";
const VK_API_URL = "https://api.vk.com/method/messages.send";

const START_COMMANDS = new Set(["/start", "start", "начать"]);
const GET_SCHEDULE_COMMAND = "получить расписание";
const PROGRAMS = [
  "Лечебное дело",
  "Педиатрия",
  "Стоматология",
  "Медицинская биохимия",
];
const PROGRAM_BY_NORMALIZED_TEXT = new Map(
  PROGRAMS.map((program) => [program.toLowerCase(), program]),
);

const WELCOME_REPLY = [
  "👋 Добро пожаловать!",
  "",
  "Здесь можно получить расписание Кировского ГМУ в календарь телефона.",
  "Нажмите «Получить расписание», чтобы начать подбор.",
].join("\n");

const SCHEDULE_REPLY = [
  "Выберите направление подготовки:",
  "",
  "После выбора мы перейдём к курсу и группе.",
].join("\n");

function selectedProgramReply(program) {
  return [
    `✅ Вы выбрали: ${program}.`,
    "",
    "Направление сохранено для текущего шага. Далее подключаем выбор курса и группы.",
  ].join("\n");
}

function textButton(label, payload, color = "secondary") {
  return {
    action: {
      type: "text",
      label,
      payload: JSON.stringify(payload),
    },
    color,
  };
}

function keyboard(buttonRows, { oneTime = false, inline = false } = {}) {
  return JSON.stringify({
    one_time: oneTime,
    inline,
    buttons: buttonRows,
  });
}

const START_KEYBOARD = keyboard([
  [textButton("Получить расписание", { action: "get_schedule" }, "primary")],
]);

const PROGRAM_KEYBOARD = keyboard([
  [textButton("Лечебное дело", { action: "program", program: "medicine" }, "primary")],
  [textButton("Педиатрия", { action: "program", program: "pediatrics" }, "primary")],
  [textButton("Стоматология", { action: "program", program: "dentistry" }, "primary")],
  [textButton("Медицинская биохимия", { action: "program", program: "biochemistry" })],
]);

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("request_too_large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("invalid_json");
  }
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function groupMatches(actual, expected) {
  return expected && String(actual ?? "") === String(expected);
}

function incomingMessage(event) {
  if (event?.type !== "message_new") return null;
  const message = event?.object?.message;
  if (!message || typeof message !== "object") return null;
  if (!Number.isInteger(message.peer_id)) return null;
  return message;
}

function normalizeMessageText(message) {
  return String(message?.text || "").trim().toLowerCase();
}

async function sendVkMessage({ token, apiVersion, peerId, message, keyboard: messageKeyboard, fetchImpl, randomId }) {
  const body = new URLSearchParams({
    access_token: token,
    v: apiVersion,
    peer_id: String(peerId),
    random_id: String(randomId),
    message,
  });
  if (messageKeyboard) body.set("keyboard", messageKeyboard);

  const response = await fetchImpl(VK_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error(`vk_http_${response.status}`);
  const result = await response.json();
  if (result?.error) throw new Error(`vk_api_${result.error.error_code || "error"}`);
  return result?.response;
}

export function createVkCallbackHandler(env = process.env, dependencies = {}) {
  const groupId = String(env.VK_CALLBACK_GROUP_ID || "").trim();
  const confirmationCode = String(env.VK_CALLBACK_CONFIRMATION_CODE || "").trim();
  const secret = String(env.VK_CALLBACK_SECRET || "").trim();
  const accessToken = String(env.VK_ACCESS_TOKEN || "").trim();
  const apiVersion = String(env.VK_API_VERSION || "5.199").trim();
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const randomIdFactory = dependencies.randomIdFactory || (() => Math.floor(Math.random() * 2147483647) + 1);

  async function reply(message, text, messageKeyboard) {
    if (!accessToken) {
      console.error("vk reply skipped: VK_ACCESS_TOKEN is not configured");
      return;
    }
    try {
      await sendVkMessage({
        token: accessToken,
        apiVersion,
        peerId: message.peer_id,
        message: text,
        keyboard: messageKeyboard,
        fetchImpl,
        randomId: randomIdFactory(),
      });
      console.log("vk reply sent", { peerId: message.peer_id });
    } catch (error) {
      console.error("vk reply failed", error);
    }
  }

  return async function handleVkCallback(request, response) {
    try {
      const event = await readJson(request);

      if (!groupId || !confirmationCode) {
        return sendText(response, 503, "vk_callback_not_configured");
      }

      if (!groupMatches(event.group_id, groupId)) {
        return sendText(response, 403, "forbidden");
      }

      if (event.type === "confirmation") {
        return sendText(response, 200, confirmationCode);
      }

      if (!secret) {
        return sendText(response, 503, "vk_callback_secret_not_configured");
      }

      if (event.secret !== secret) {
        return sendText(response, 403, "forbidden");
      }

      console.log("vk callback", {
        type: typeof event.type === "string" ? event.type : "unknown",
        groupId,
        eventId: typeof event.event_id === "string" ? event.event_id : undefined,
      });

      const message = incomingMessage(event);
      if (message) {
        const text = normalizeMessageText(message);
        if (text === TEST_COMMAND) {
          await reply(message, TEST_REPLY);
        } else if (START_COMMANDS.has(text)) {
          await reply(message, WELCOME_REPLY, START_KEYBOARD);
        } else if (text === GET_SCHEDULE_COMMAND) {
          await reply(message, SCHEDULE_REPLY, PROGRAM_KEYBOARD);
        } else {
          const program = PROGRAM_BY_NORMALIZED_TEXT.get(text);
          if (program) await reply(message, selectedProgramReply(program));
        }
      }

      return sendText(response, 200, "ok");
    } catch (error) {
      if (["invalid_json", "request_too_large"].includes(error.message)) {
        return sendText(response, 400, error.message);
      }
      console.error("vk callback failed", error);
      return sendText(response, 500, "internal_error");
    }
  };
}
