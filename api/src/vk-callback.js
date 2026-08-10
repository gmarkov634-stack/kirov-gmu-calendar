const MAX_BODY_BYTES = 65536;

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

export function createVkCallbackHandler(env = process.env) {
  const groupId = String(env.VK_CALLBACK_GROUP_ID || "").trim();
  const confirmationCode = String(env.VK_CALLBACK_CONFIRMATION_CODE || "").trim();
  const secret = String(env.VK_CALLBACK_SECRET || "").trim();

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
