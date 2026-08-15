# VK control plane

`ops/vk/command.json` — временный служебный файл для выполнения одной команды через GitHub Actions.

Командный файл не хранится в `main`: для операции создаётся отдельная ветка и pull request, workflow получает GitHub OIDC token и передаёт команду в `calendar-api`. После получения результата pull request закрывается без слияния.

Поддерживаемые действия:

- `wall.list`
- `wall.post`
- `wall.edit`
- `wall.delete`
- `wall.pin`
- `wall.unpin`

## VK tokens

Интеграция разделяет два контура авторизации:

- `VK_ACCESS_TOKEN` — токен сообщества для Callback API и сообщений;
- пользовательская OAuth-сессия администратора — для `wall.*`.

Legacy `VK_USER_ACCESS_TOKEN` остаётся совместимым статическим fallback, но основной путь — VK ID OAuth с encrypted vault и автоматическим refresh.

Токен сообщества никогда не используется как fallback для пользовательских методов стены.

## VK ID OAuth

Зарегистрировано отдельное Web-приложение VK ID для административной авторизации стены:

- public Client ID: `54722093`;
- base domain: `kgmu-calendar-api.containerapps.ru`;
- trusted redirect URL: `https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback`.

`/api/v1/vk/oauth/start` — стартовая страница без client-side JavaScript. `/api/v1/vk/oauth/begin` создаёт свежие `state` и PKCE verifier/challenge на сервере, сохраняет state/verifier только в короткоживущих `HttpOnly; Secure; SameSite=Lax` cookie и перенаправляет в VK ID с минимальным scope `wall groups`.

`/api/v1/vk/oauth/callback` проверяет обязательные параметры и совпадение `state`, обменивает одноразовый authorization code на пользовательский token через OAuth 2.1/PKCE и сначала выполняет `wall.get` для `VK_CALLBACK_GROUP_ID`. Только после успешного `wall.get` разрешено постоянное сохранение.

## Encrypted token vault

Для постоянной OAuth-сессии используется отдельный secret `VK_OAUTH_ENCRYPTION_KEY`. Допустимые представления: ровно 32 байта в base64url/base64 или 64 hex-символа.

Access token, refresh token и `device_id` шифруются AES-256-GCM до записи в object storage. В S3 хранится только envelope `secure/vk/oauth-credentials.v1.json` с `iv`, authentication tag и ciphertext; plaintext-токены не записываются. Для локальной разработки используется тот же encrypted envelope в `DATA_DIR` с режимом файла `0600`.

При отсутствии или некорректной длине `VK_OAUTH_ENCRYPTION_KEY` vault fail-closed: OAuth probe может подтвердить `wall.get`, но access/refresh token не сохраняются и managed wall endpoint остаётся не настроенным.

После сохранения `VkTokenManager` использует access token до истечения срока. За 2 минуты до expiry он выполняет официальный VK ID refresh flow через `https://id.vk.ru/oauth2/auth` с `grant_type=refresh_token`, тем же `device_id`, свежим `state` и зарегистрированным redirect URI. Ответный `state` проверяется, refresh token ротируется и новый bundle атомарно перезаписывается в encrypted vault.

`/api/v1/vk/wall` использует managed token manager и автоматически refresh-ит токен. GitHub OIDC control plane для write-операций переводится на тот же manager отдельным шагом после production-проверки encrypted read path.

Защищённый ключ приложения, сервисный ключ, `VK_OAUTH_ENCRYPTION_KEY`, access token и refresh token никогда не должны попадать в GitHub, command-файлы, issue/PR, логи или чат.
