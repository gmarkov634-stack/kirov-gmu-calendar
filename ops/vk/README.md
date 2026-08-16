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
| `group.edit` | community `VK_ACCESS_TOKEN` | **PASS**; только allowlist `description` + `website`, production verified 16.08.2026 |
| `photo.importWall` | managed VK ID user OAuth | **PENDING REAUTH**; код и production deploy готовы, первый probe на старой сессии `wall groups` вернул VK error 15; новый scope `wall groups photos` уже развернут |

Автоматические fallback между классами токенов запрещены. Успех одного `wall.*`, `photos.*` или `groups.*` метода не считается доказательством поддержки другого.

Практический operational contract: ChatGPT может через GitHub OIDC безопасно читать стену, публиковать новые текстовые записи, читать allowlisted публичные метаданные сообщества и — только после явного подтверждения пользователя — менять `description` и `website`. Закрепление и удаление выполняются вручную в интерфейсе VK. `wall.edit` нельзя считать production-подтверждённым до отдельного контролируемого теста. Публикация поста с изображением состоит из двух отдельных операций: `photo.importWall` получает VK photo attachment, затем production-подтверждённый `wall.post` публикует согласованный текст с этим attachment.

## Wall photo import

PR #151 добавил защищённый `photo.importWall`. Источник изображения ограничен HTTPS URL из `raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/.../ops/vk/assets/`, разрешены только JPEG/PNG до 8 МБ. Это SSRF boundary: произвольный внешний URL использовать нельзя.

Flow: managed user OAuth → `photos.getWallUploadServer` → multipart upload → `photos.saveWallPhoto` → наружу возвращается только безопасный attachment вида `photo<owner_id>_<id>`. Community token для этого flow намеренно не используется. Сам `wall.post` остаётся отдельной community-token операцией.

Утверждённый visual для следующего поста сохранён PR #152 в `ops/vk/assets/post66-study-day-approved-20260816.jpg`.

Первый production probe через operational PR #155 дошёл до VK и вернул `vk_api_error`, code `15` (`Access denied`). Стена при этом не изменялась. Причина — сохранённая managed VK ID сессия была выдана со scope `wall groups`. PR #156 изменил требуемый scope на `wall groups photos`; regression и production deploy/smoke прошли. До повторного production probe администратор должен один раз пройти штатный OAuth flow и подтвердить новое право `photos`. Только после успешного probe capability можно перевести из `PENDING REAUTH` в `PASS`.

## Group metadata read/write

`group.info` использует официальный `groups.getById` и community token. Managed VK ID token для этой команды не запрашивается. Ответ намеренно ограничен allowlist: `id`, `name`, `screenName`, `type`, `isClosed`, `description`, `website`, `activity`, `status`, `membersCount`, `verified`, `city`, `country`. Admin/service metadata не возвращаются.

Первый production read выполнен 16.08.2026 через operational PR #144. Он выявил устаревшее описание с ценой `490 ₽` и пустой website; никаких настроек на этом шаге не менялось.

PR #146 добавил `group.edit` как отдельную community-token mutation-команду. Writable allowlist намеренно ограничен ровно двумя полями: `description` и `website`. Пустой payload, любые посторонние поля, слишком длинные значения и не-HTTPS website блокируются до обращения к VK. При отсутствии community token команда fail-closed и не переключается на managed/static user token.

После явного подтверждения пользователя operational PR #147 передал только согласованные `description` и `website`. Production ответ: `updated=true`, `fields=[description, website]`. PR закрыт без merge. Затем operational PR #148 выполнил независимый read-only `group.info`, подтвердил точный результат и также был закрыт без merge.

Итоговое состояние после проверки:

- name: `Расписание в телефоне | Киров ГМУ`;
- screenName: `calendarksmu`;
- group access: open (`isClosed=0`);
- website: `https://gmarkov634-stack.github.io/kirov-gmu-calendar`;
- activity: `Объявления`;
- status: `Для Apple и Google календаря`;
- membersCount на момент проверки: `24`;
- description: актуальная версия без цены, с объяснением ценности календаря и ожидания официального расписания 2026/27; точная публичная копия хранится в `ops/vk/CONTENT.md`.

Название, короткий адрес, тип/доступ группы, activity и status при mutation #147 не менялись. Перед любым будущим изменением метаданных пользователь должен увидеть точный diff «было → станет» и явно подтвердить его.

## VK tokens

Интеграция разделяет два контура авторизации:

- `VK_ACCESS_TOKEN` — токен сообщества для Callback API, сообщений, подтверждённого `wall.post`, read-only `group.info` и строго allowlisted `group.edit`;
- пользовательская OAuth-сессия администратора VK ID — для подтверждённого чтения стены, user-token маршрутов и `photo.importWall`.

Legacy `VK_USER_ACCESS_TOKEN` остаётся совместимым статическим fallback для user-token операций, но основной путь — VK ID OAuth с encrypted vault и автоматическим refresh.

Community token никогда не используется как fallback для user-token операций; managed user token никогда не используется как fallback для community-only операций.

## VK ID OAuth

Зарегистрировано отдельное Web-приложение VK ID для административной авторизации стены:

- public Client ID: `54722093`;
- base domain: `kgmu-calendar-api.containerapps.ru`;
- trusted redirect URL: `https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback`.

`/api/v1/vk/oauth/start` — стартовая страница без client-side JavaScript. `/api/v1/vk/oauth/begin` создаёт свежие `state` и PKCE verifier/challenge на сервере, сохраняет state/verifier только в короткоживущих `HttpOnly; Secure; SameSite=Lax` cookie и перенаправляет в VK ID. С 16.08.2026 требуемый scope — `wall groups photos`: `photos` нужен только для загрузки уже утверждённых изображений к записям сообщества.

`/api/v1/vk/oauth/callback` проверяет обязательные параметры и совпадение `state`, обменивает одноразовый authorization code на пользовательский token через OAuth 2.1/PKCE и сначала выполняет `wall.get` для `VK_CALLBACK_GROUP_ID`. Только после успешного `wall.get` разрешено постоянное сохранение.

## Encrypted token vault

Для постоянной OAuth-сессии используется отдельный secret `VK_OAUTH_ENCRYPTION_KEY`. Допустимые представления: ровно 32 байта в base64url/base64 или 64 hex-символа.

Access token, refresh token и `device_id` шифруются AES-256-GCM до записи в object storage. В S3 хранится только envelope `secure/vk/oauth-credentials.v1.json` с `iv`, authentication tag и ciphertext; plaintext-токены не записываются. Для локальной разработки используется тот же encrypted envelope в `DATA_DIR` с режимом файла `0600`.

При отсутствии или некорректной длине `VK_OAUTH_ENCRYPTION_KEY` vault fail-closed: OAuth probe может подтвердить `wall.get`, но access/refresh token не сохраняются и managed wall endpoint остаётся не настроенным.

После сохранения `VkTokenManager` использует access token до истечения срока. За 2 минуты до expiry он выполняет VK ID refresh flow через `https://id.vk.ru/oauth2/auth` с `grant_type=refresh_token`, тем же `device_id`, свежим `state` и зарегистрированным redirect URI. Ответный `state` проверяется, refresh token ротируется и новый bundle атомарно перезаписывается в encrypted vault.

`/api/v1/vk/wall`, `wall.list` и `photo.importWall` через GitHub OIDC используют managed token manager и автоматически refresh-ят пользовательский access token. `wall.post`, `group.info` и строго allowlisted `group.edit` используют community token.

## Cloud.ru deploy boundary

Во время внедрения `photo.importWall` Cloud.ru временно возвращал контейнер `running`, но revisions API не отмечал ни одну ревизию как `active`. PR #153 сделал current container resource авторитетным источником readiness и exact immutable image, а revisions list — диагностическим источником; состояние с несколькими active revisions по-прежнему fail-closed. PR #154 вернул полный production smoke: catalog, auth guards и authenticated funnel v2 (`FUNNEL_V2_SAFE`). После #154 и #156 цепочки publish → deploy → production smoke прошли успешно.

## Current wall state after cleanup

16.08.2026 read-only cleanup verification через `wall.list` вернула `total=1`:

- пост #64 «Расписание Кировского ГМУ — прямо в календаре телефона 📅»;
- `isPinned=true`;
- старые посты #59 и #60 удалены вручную;
- operational PR #139 после проверки закрыт без merge.

После этой cleanup-проверки через production `wall.post` дополнительно опубликован пост #65 о неудобстве Excel/распечаток/скриншотов как ежедневного интерфейса расписания. Operational PR #141 закрыт без merge после успешной публикации.

Пост #64 был создан через `wall.post`; закрепление выполнено вручную, поскольку `wall.pin` не поддерживается текущими credential classes. Устаревшие #59/#60 удалены вручную, поскольку `wall.delete` не поддерживается текущими credential classes.

Защищённый ключ приложения, сервисный ключ, `VK_OAUTH_ENCRYPTION_KEY`, access token и refresh token никогда не должны попадать в GitHub, command-файлы, issue/PR, логи или чат.
