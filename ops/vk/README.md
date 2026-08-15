# VK control plane

`ops/vk/command.json` — временный служебный файл для выполнения одной команды через GitHub Actions.

Командный файл не хранится в `main`: для операции создаётся отдельная ветка и pull request, workflow получает GitHub OIDC token и передаёт команду в `calendar-api`. После получения результата pull request закрывается без слияния.

## Production capability matrix

Проверено реальными вызовами 15–16.08.2026 для сообщества `VK_CALLBACK_GROUP_ID=191574528`:

| Action | Credential path | Production status |
| --- | --- | --- |
| `wall.list` | managed VK ID user OAuth | **PASS** |
| `wall.post` | community `VK_ACCESS_TOKEN` | **PASS**; посты #64 и #65 созданы через control plane |
| `wall.edit` | managed VK ID user OAuth | маршрут реализован, отдельный production mutation-test ещё не выполнен |
| `wall.delete` | unsupported | **fail-closed HTTP 501**; VK ID → error 1051, community token → error 27 |
| `wall.pin` | unsupported | **fail-closed HTTP 501**; VK ID → error 1051, community token → error 27 |
| `wall.unpin` | unsupported | **fail-closed HTTP 501** вместе с `wall.pin` |
| `group.info` | community `VK_ACCESS_TOKEN` | **PASS**; read-only `groups.getById`, production verified 16.08.2026 |

Автоматические fallback между классами токенов запрещены. Успех одного `wall.*` или `groups.*` метода не считается доказательством поддержки другого.

Практический operational contract: ChatGPT может через GitHub OIDC безопасно читать стену, публиковать новые текстовые записи и читать allowlisted публичные метаданные сообщества. Закрепление и удаление выполняются вручную в интерфейсе VK, пока отдельная поддерживаемая credential-схема для этих методов не появится. `wall.edit` нельзя считать production-подтверждённым до отдельного контролируемого теста.

## Group metadata read-only

`group.info` использует официальный `groups.getById` и community token. Managed VK ID token для этой команды не запрашивается. Ответ намеренно ограничен allowlist: `id`, `name`, `screenName`, `type`, `isClosed`, `description`, `website`, `activity`, `status`, `membersCount`, `verified`, `city`, `country`. Admin/service metadata не возвращаются.

Первый production read выполнен 16.08.2026 через operational PR #144, который после выполнения закрыт без merge. На момент чтения:

- name: `Расписание в телефоне | Киров ГМУ`;
- screenName: `calendarksmu`;
- group access: open (`isClosed=0`);
- website: пусто;
- activity: `Объявления`;
- status: `Для Apple и Google календаря`;
- membersCount: `24`;
- description содержит устаревшую цену `490 ₽` и формулировки, которые требуют актуализации перед запуском 2026/27.

На read-only этапе настройки VK не изменялись. Следующая mutation-boundary для информации сообщества: сначала показать пользователю точный diff «было → станет», получить явное подтверждение и только затем добавлять/использовать строго allowlisted `group.edit` для ровно согласованных полей.

## VK tokens

Интеграция разделяет два контура авторизации:

- `VK_ACCESS_TOKEN` — токен сообщества для Callback API, сообщений, подтверждённого `wall.post` и read-only `group.info`;
- пользовательская OAuth-сессия администратора VK ID — для подтверждённого чтения стены и user-token маршрутов.

Legacy `VK_USER_ACCESS_TOKEN` остаётся совместимым статическим fallback для user-token операций, но основной путь — VK ID OAuth с encrypted vault и автоматическим refresh.

Community token никогда не используется как fallback для user-token операций; managed user token никогда не используется как fallback для community-only операций.

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

После сохранения `VkTokenManager` использует access token до истечения срока. За 2 минуты до expiry он выполняет VK ID refresh flow через `https://id.vk.ru/oauth2/auth` с `grant_type=refresh_token`, тем же `device_id`, свежим `state` и зарегистрированным redirect URI. Ответный `state` проверяется, refresh token ротируется и новый bundle атомарно перезаписывается в encrypted vault.

`/api/v1/vk/wall` и `wall.list` через GitHub OIDC используют managed token manager и автоматически refresh-ят пользовательский access token. `wall.post` и `group.info` используют community token.

## Current wall state after cleanup

16.08.2026 read-only cleanup verification через `wall.list` вернула `total=1`:

- пост #64 «Расписание Кировского ГМУ — прямо в календаре телефона 📅»;
- `isPinned=true`;
- старые посты #59 и #60 удалены вручную;
- operational PR #139 после проверки закрыт без merge.

После этой cleanup-проверки через production `wall.post` дополнительно опубликован пост #65 о неудобстве Excel/распечаток/скриншотов как ежедневного интерфейса расписания. Operational PR #141 закрыт без merge после успешной публикации.

Пост #64 был создан через `wall.post`; закрепление выполнено вручную, поскольку `wall.pin` не поддерживается текущими credential classes. Устаревшие #59/#60 удалены вручную, поскольку `wall.delete` не поддерживается текущими credential classes.

Защищённый ключ приложения, сервисный ключ, `VK_OAUTH_ENCRYPTION_KEY`, access token и refresh token никогда не должны попадать в GitHub, command-файлы, issue/PR, логи или чат.
