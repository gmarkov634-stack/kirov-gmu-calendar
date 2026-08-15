const APP_ID = 54722093;
const REDIRECT_URL = "https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback";
const SDK_URL = "https://unpkg.com/@vkid/sdk@2.6.1/dist-sdk/umd/index.js";
const PROBE_SCOPE = "wall groups";

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self' https://unpkg.com",
      "connect-src https://*.vk.ru https://*.vk.com",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "style-src 'unsafe-inline'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Проверка доступа VK</title>
</head>
<body>
  <main>
    <h1>Проверка доступа VK</h1>
    <p>Будут запрошены только права <code>wall</code> и <code>groups</code>. На этом этапе токены не сохраняются.</p>
    <button id="vk-auth" type="button">Проверить доступ VK</button>
    <p id="status" role="status"></p>
  </main>
  <script src="${SDK_URL}"></script>
  <script>
    (() => {
      const button = document.getElementById('vk-auth');
      const status = document.getElementById('status');

      function randomBase64Url(bytes = 32) {
        const data = new Uint8Array(bytes);
        crypto.getRandomValues(data);
        let binary = '';
        for (const value of data) binary += String.fromCharCode(value);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      }

      if (!window.VKIDSDK) {
        button.disabled = true;
        status.textContent = 'VK ID SDK не загрузился. Обновите страницу.';
        return;
      }

      const state = randomBase64Url(24);
      const codeVerifier = randomBase64Url(48);

      VKIDSDK.Config.init({
        app: ${APP_ID},
        redirectUrl: ${JSON.stringify(REDIRECT_URL)},
        state,
        codeVerifier,
        scope: ${JSON.stringify(PROBE_SCOPE)},
      });

      button.addEventListener('click', () => {
        button.disabled = true;
        status.textContent = 'Открываю VK ID…';
        VKIDSDK.Auth.login().catch(() => {
          button.disabled = false;
          status.textContent = 'Не удалось открыть VK ID. Попробуйте ещё раз.';
        });
      });
    })();
  </script>
</body>
</html>`;
}

export function createVkOauthStartHandler() {
  return async function handleVkOauthStart(request, response) {
    if (request.method !== "GET") {
      response.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET",
      });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    return sendHtml(response, 200, page());
  };
}

export const VK_OAUTH_PROBE = Object.freeze({
  appId: APP_ID,
  redirectUrl: REDIRECT_URL,
  scope: PROBE_SCOPE,
  sdkUrl: SDK_URL,
});
