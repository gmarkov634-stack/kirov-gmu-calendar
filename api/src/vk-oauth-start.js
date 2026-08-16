import { createHash, randomBytes } from "node:crypto";

const APP_ID = 54722093;
const REDIRECT_URL = "https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback";
const PROBE_SCOPE = "wall groups photos";
const VKID_AUTHORIZE_URL = "https://id.vk.ru/authorize";
const SDK_VERSION = "2.6.1";
const START_PATH = "/api/v1/vk/oauth/start";
const BEGIN_PATH = "/api/v1/vk/oauth/begin";

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  });
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

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Доступ VK для календаря</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px 20px; color: #111; }
    main { max-width: 680px; margin: 0 auto; }
    h1 { font-size: 32px; margin: 0 0 18px; }
    p { font-size: 18px; line-height: 1.5; }
    a.button { display: inline-block; margin-top: 8px; padding: 12px 18px; border-radius: 10px; background: #07f; color: white; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Доступ VK для календаря</h1>
    <p>Будут запрошены права <code>wall</code>, <code>groups</code> и <code>photos</code>. Право <code>photos</code> нужно только для загрузки утверждённых изображений к записям сообщества.</p>
    <p>После успешной проверки административная OAuth-сессия сохраняется только в зашифрованном хранилище сервиса.</p>
    <p><a class="button" href="${BEGIN_PATH}">Обновить доступ VK</a></p>
  </main>
</body>
</html>`;
}

function buildAuthorizationUrl() {
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const url = new URL(VKID_AUTHORIZE_URL);
  url.searchParams.set("client_id", String(APP_ID));
  url.searchParams.set("app_id", String(APP_ID));
  url.searchParams.set("redirect_uri", REDIRECT_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PROBE_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "s256");
  url.searchParams.set("v", SDK_VERSION);
  url.searchParams.set("sdk_type", "vkid");

  return { url: url.toString(), state, codeVerifier };
}

function probeCookie(name, value) {
  return `${name}=${value}; Path=/api/v1/vk/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=900`;
}

export function createVkOauthStartHandler() {
  return async function handleVkOauthStart(request, response) {
    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "method_not_allowed" }, { Allow: "GET" });
    }

    const url = new URL(request.url, "http://localhost");
    if (url.pathname === START_PATH) {
      return sendHtml(response, 200, page());
    }

    if (url.pathname === BEGIN_PATH) {
      const auth = buildAuthorizationUrl();
      response.writeHead(302, {
        ...securityHeaders(),
        Location: auth.url,
        "Set-Cookie": [
          probeCookie("vk_oauth_probe_state", auth.state),
          probeCookie("vk_oauth_probe_verifier", auth.codeVerifier),
        ],
      });
      response.end();
      return;
    }

    return sendJson(response, 404, { error: "not_found" });
  };
}

export const VK_OAUTH_PROBE = Object.freeze({
  appId: APP_ID,
  redirectUrl: REDIRECT_URL,
  scope: PROBE_SCOPE,
  authorizeUrl: VKID_AUTHORIZE_URL,
  startPath: START_PATH,
  beginPath: BEGIN_PATH,
});
