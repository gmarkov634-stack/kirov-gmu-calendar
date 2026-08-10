const MAX_BODY_BYTES = 65536;
const TEST_COMMAND = "/calendar-test";
const TEST_REPLY = "calendar-api подключён ✅";
const VK_API_URL = "https://api.vk.com/method/messages.send";

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

async function sendVkMessage({ token, apiVersion, peerId, message, fetchImpl, randomId }) {
  const body = new URLSearchParams({
    access_token: token,
    v: apiVersion,
    peer_id: String(peerId),
    random_id: String(randomId),
    message,
  });

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
      if (message && String(message.text || "").trim().toLowerCase() === TEST_COMMAND) {
        if (!accessToken) {
          console.error("vk test reply skipped: VK_ACCESS_TOKEN is not configured");
        } else {
          try {
            await sendVkMessage({
              token: accessToken,
              apiVersion,
              peerId: message.peer_id,
              message: TEST_REPLY,
              fetchImpl,
              randomId: randomIdFactory(),
            });
            console.log("vk test reply sent", { peerId: message.peer_id });
          } catch (error) {
            console.error("vk test reply failed", error);
          }
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
