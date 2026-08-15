function sendHtml(response, status, title, message) {
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

  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

export function createVkOauthCallbackHandler() {
  return async function handleVkOauthCallback(request, response) {
    if (request.method !== "GET") {
      response.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET",
      });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const url = new URL(request.url, "http://localhost");

    // Provider errors are deliberately not echoed back: they can contain
    // request-specific details and this endpoint is public.
    if (url.searchParams.has("error")) {
      return sendHtml(
        response,
        400,
        "Авторизация VK ID не завершена",
        "VK ID вернул отказ или ошибку. Код, токены и параметры ответа не сохранялись.",
      );
    }

    const hasCode = Boolean(url.searchParams.get("code"));
    const hasState = Boolean(url.searchParams.get("state"));
    const hasDeviceId = Boolean(url.searchParams.get("device_id") || url.searchParams.get("deviceId"));

    if (!hasCode || !hasState || !hasDeviceId) {
      return sendHtml(
        response,
        400,
        "Некорректный ответ VK ID",
        "Не хватает обязательных параметров OAuth-ответа. Никакие значения не сохранены.",
      );
    }

    // Phase 1 is intentionally receive-only. Do not log, persist or display
    // authorization code/state/device id until the PKCE exchange and refresh
    // strategy is implemented and reviewed.
    return sendHtml(
      response,
      200,
      "Ответ VK ID получен",
      "Callback работает. Код авторизации и другие параметры не отображались, не сохранялись и не обменивались на токены.",
    );
  };
}
