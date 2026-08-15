const APP_ID = 54722093;
const REDIRECT_URL = "https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback";
const VKID_TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const VK_WALL_GET_URL = "https://api.vk.com/method/wall.get";
const DEFAULT_API_VERSION = "5.199";
const STATE_COOKIE = "vk_oauth_probe_state";
const VERIFIER_COOKIE = "vk_oauth_probe_verifier";

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function clearProbeCookies() {
  const attrs = "Path=/api/v1/vk/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  return [
    `${STATE_COOKIE}=; ${attrs}`,
    `${VERIFIER_COOKIE}=; ${attrs}`,
  ];
}

function sendHtml(response, status, title, message, { clearCookies = false } = {}) {
  const body = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;

  const headers = {
    ...securityHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  };
  if (clearCookies) headers["Set-Cookie"] = clearProbeCookies();
  response.writeHead(status, headers);
  response.end(body);
}

function sendJson(response, status, body, extra = {}) {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
  response.end(JSON.stringify(body));
}

function parseCookies(header = "") {
  const result = new Map();
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

async function exchangeCode({ code, state, deviceId, codeVerifier, fetchImpl }) {
  const url = new URL(VKID_TOKEN_URL);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("redirect_uri", REDIRECT_URL);
  url.searchParams.set("client_id", String(APP_ID));
  url.searchParams.set("code_verifier", codeVerifier);
  url.searchParams.set("state", state);
  url.searchParams.set("device_id", deviceId);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }),
  });
  if (!response.ok) throw new Error(`vkid_http_${response.status}`);
  const result = await response.json();
  if (result?.error) throw new Error(`vkid_${String(result.error)}`);
  if (result?.state && result.state !== state) throw new Error("vkid_state_mismatch");
  if (!result?.access_token) throw new Error("vkid_access_token_missing");
  return result;
}

async function probeWall({ accessToken, groupId, apiVersion, fetchImpl }) {
  const response = await fetchImpl(VK_WALL_GET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: accessToken,
      v: apiVersion,
      owner_id: `-${groupId}`,
      count: "1",
      filter: "owner",
      extended: "0",
    }),
  });
  if (!response.ok) throw new Error(`vk_http_${response.status}`);
  const result = await response.json();
  if (result?.error) throw new Error(`vk_api_${result.error.error_code || "error"}`);
  return Number(result?.response?.count || 0);
}

export function createVkOauthCallbackHandler(env = process.env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const groupId = String(env.VK_CALLBACK_GROUP_ID || "").trim();
  const apiVersion = String(env.VK_API_VERSION || DEFAULT_API_VERSION).trim();

  return async function handleVkOauthCallback(request, response) {
    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "method_not_allowed" }, { Allow: "GET" });
    }

    const url = new URL(request.url, "http://localhost");

    if (url.searchParams.has("error")) {
      return sendHtml(
        response,
        400,
        "Авторизация VK ID не завершена",
        "VK ID вернул отказ или ошибку. Токены не сохранялись.",
        { clearCookies: true },
      );
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const deviceId = url.searchParams.get("device_id") || url.searchParams.get("deviceId") || "";
    if (!code || !state || !deviceId) {
      return sendHtml(
        response,
        400,
        "Некорректный ответ VK ID",
        "Не хватает обязательных параметров OAuth-ответа. Токены не сохранялись.",
        { clearCookies: true },
      );
    }

    const cookies = parseCookies(request.headers?.cookie || "");
    const expectedState = cookies.get(STATE_COOKIE) || "";
    const codeVerifier = cookies.get(VERIFIER_COOKIE) || "";
    if (!expectedState || !codeVerifier || expectedState !== state) {
      return sendHtml(
        response,
        400,
        "Проверка OAuth не пройдена",
        "Состояние авторизации не совпало или истекло. Запустите проверку доступа заново.",
        { clearCookies: true },
      );
    }

    if (!groupId || !/^\d+$/.test(groupId)) {
      return sendHtml(
        response,
        503,
        "VK группа не настроена",
        "На сервере отсутствует корректный идентификатор группы. Токены не сохранялись.",
        { clearCookies: true },
      );
    }

    try {
      const tokenResult = await exchangeCode({ code, state, deviceId, codeVerifier, fetchImpl });
      const postCount = await probeWall({
        accessToken: tokenResult.access_token,
        groupId,
        apiVersion,
        fetchImpl,
      });

      return sendHtml(
        response,
        200,
        "Доступ к стене VK подтверждён",
        `Пользовательский токен успешно прошёл wall.get для сообщества. На стене найдено записей: ${postCount}. Токен и refresh token не отображались и не сохранялись.`,
        { clearCookies: true },
      );
    } catch (error) {
      const reason = String(error?.message || "vk_oauth_probe_failed").replace(/[^a-zA-Z0-9_-]/g, "_");
      console.error("VK OAuth wall probe failed", reason);
      return sendHtml(
        response,
        502,
        "Проверка доступа к стене не пройдена",
        "VK ID вернул токен, но проверка wall.get не завершилась успешно. Секреты не отображались и не сохранялись.",
        { clearCookies: true },
      );
    }
  };
}

export const VK_OAUTH_EXCHANGE = Object.freeze({
  appId: APP_ID,
  redirectUrl: REDIRECT_URL,
  tokenUrl: VKID_TOKEN_URL,
  wallGetUrl: VK_WALL_GET_URL,
  stateCookie: STATE_COOKIE,
  verifierCookie: VERIFIER_COOKIE,
});
