# VK control plane

`ops/vk/command.json` — временный служебный файл для выполнения одной команды через GitHub Actions. Для operational-команды создаётся отдельная ветка и PR; workflow получает GitHub OIDC token и передаёт команду в production `calendar-api`. После получения результата PR закрывается без merge.

## Production capability matrix

Проверено реальными вызовами 15–16.08.2026 для сообщества `VK_CALLBACK_GROUP_ID=191574528`:

| Action | Credential path | Production status |
| --- | --- | --- |
| `wall.list` | managed VK ID user OAuth | **PASS** |
| `wall.post` | community `VK_ACCESS_TOKEN` | **PASS**; посты #64, #65 и #66 созданы через control plane |
| `wall.edit` | managed VK ID user OAuth | **UNSUPPORTED with current managed token**; production #66 probe → VK error 1051 |
| `wall.delete` | unsupported | **fail-closed HTTP 501**; VK ID → 1051, community → 27 |
| `wall.pin` | unsupported | **fail-closed HTTP 501**; VK ID → 1051, community → 27 |
| `wall.unpin` | unsupported | **fail-closed HTTP 501** вместе с `wall.pin` |
| `group.info` | community `VK_ACCESS_TOKEN` | **PASS**; read-only `groups.getById` |
| `group.edit` | community `VK_ACCESS_TOKEN` | **PASS**; только allowlist `description` + `website` |
| `photo.importWall` | managed VK ID user OAuth | **UNSUPPORTED with current managed token**; после reauth со scope `wall groups photos` production probe всё равно → VK error 15 |
| `photo.importMessages` | community `VK_ACCESS_TOKEN` | **PASS as photo storage only**; VK photo сохраняется, но message-photo attachment не прикрепляется к wall post |

Автоматические fallback между классами токенов запрещены. Успех одного `wall.*`, `photos.*` или `groups.*` метода не считается доказательством поддержки другого.

Практический operational contract на текущих credentials: ChatGPT может безопасно читать стену, публиковать **текстовые** записи, читать allowlisted metadata сообщества и после явного подтверждения менять `description`/`website`. Закрепление, удаление и добавление изображения к wall post выполняются вручную в VK. `wall.edit` не использовать повторно с managed VK ID после подтверждённого error 1051.

## Wall photo boundary

PR #151 добавил защищённый `photo.importWall`: источник изображения ограничен HTTPS URL из `raw.githubusercontent.com/gmarkov634-stack/kirov-gmu-calendar/.../ops/vk/assets/`, только JPEG/PNG до 8 МБ. Flow использует managed user OAuth: `photos.getWallUploadServer → multipart upload → photos.saveWallPhoto`.

После первоначального error 15 OAuth scope был расширен PR #156 до `wall groups photos`, администратор заново прошёл штатный OAuth flow, credentials были сохранены. Повторный production probe после reauth снова вернул VK error 15. Поэтому `photo.importWall` считается неподдерживаемым текущей современной VK ID user-сессией, а не ожидающим ещё одной авторизации.

PR #159 добавил отдельный community-token `photo.importMessages` через `photos.getMessagesUploadServer → upload → photos.saveMessagesPhoto`. Этот путь production-подтверждён как **storage capability**. Operational PR #160 сохранил утверждённый JPEG поста #66 как photo `ownerId=-191574528`, `id=457239087`.

Operational PR #161 затем передал message-photo attachment в production-подтверждённый `wall.post`, и VK создал #66. Независимый `wall.list` PR #162 показал `attachments=[]`: VK не использовал message-photo как wall attachment. Следовательно `photo.importMessages` нельзя считать способом публикации картинки на стене.

Попытка исправить уже существующий #66 через `wall.edit`, сохранив точный текст и передав group-owned photo ID, завершилась production VK error 1051. Community-token `wall.edit` не вводится как неподтверждённый обход.

Утверждённый visual хранится в `ops/vk/assets/post66-study-day-approved-20260816.jpg`. До появления нового официально подтверждённого credential/method path wall-изображения прикрепляются вручную в интерфейсе VK и затем проверяются read-only `wall.list`.

## Group metadata read/write

`group.info` использует community token и официальный `groups.getById`. Ответ ограничен allowlist: `id`, `name`, `screenName`, `type`, `isClosed`, `description`, `website`, `activity`, `status`, `membersCount`, `verified`, `city`, `country`.

PR #146 добавил `group.edit` как отдельную community-token mutation-команду. Writable allowlist — только `description` и `website`; пустой payload, посторонние поля, слишком длинные значения и не-HTTPS website блокируются до VK. User-token fallback отсутствует.

После явного подтверждения operational PR #147 изменил только `description` и `website`; PR #148 read-only проверил итог:

- name: `Расписание в телефоне | Киров ГМУ`;
- screenName: `calendarksmu`;
- open group (`isClosed=0`);
- website: `https://gmarkov634-stack.github.io/kirov-gmu-calendar`;
- activity: `Объявления`;
- status: `Для Apple и Google календаря`;
- description: актуальная версия без цены; точная копия — в `ops/vk/CONTENT.md`.

Перед будущим изменением metadata пользователь должен увидеть точный diff «было → станет» и явно подтвердить его.

## VK tokens

Интеграция разделяет два контура:

- `VK_ACCESS_TOKEN` — community token для Callback API/сообщений, `wall.post`, `group.info`, allowlisted `group.edit` и `photo.importMessages` storage flow;
- managed VK ID OAuth session администратора — для `wall.list` и других user-token маршрутов.

Legacy `VK_USER_ACCESS_TOKEN` остаётся совместимым статическим fallback для user-token операций, но основной user path — encrypted VK ID OAuth. Community token никогда не используется как автоматический fallback user-token маршрута; managed user token не используется как fallback community-only маршрута.

## VK ID OAuth

Web-приложение VK ID:

- public Client ID: `54722093`;
- base domain: `kgmu-calendar-api.containerapps.ru`;
- redirect: `https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback`;
- current requested scope: `wall groups photos`.

`/api/v1/vk/oauth/start` и `/api/v1/vk/oauth/begin` используют OAuth 2.1/PKCE. `state`/verifier хранятся только в короткоживущих `HttpOnly; Secure; SameSite=Lax` cookie. Callback проверяет state, обменивает code, выполняет `wall.get` probe и только после успеха допускает сохранение credentials.

## Encrypted token vault

Managed OAuth access token, refresh token и `device_id` шифруются AES-256-GCM до записи в object storage. В хранилище находится только encrypted envelope `secure/vk/oauth-credentials.v1.json`; мастер-ключ — отдельный Cloud.ru secret `VK_OAUTH_ENCRYPTION_KEY`. При отсутствии/ошибке ключа managed path fail-closed. `VkTokenManager` обновляет истекающие credentials через VK ID refresh и атомарно перезаписывает encrypted bundle.

Защищённый ключ приложения, сервисный ключ, `VK_OAUTH_ENCRYPTION_KEY`, access token, refresh token, authorization code и PKCE verifier никогда не должны попадать в GitHub, command-файлы, issue/PR, логи или чат.

## Cloud.ru deploy boundary

Runtime-изменения проходят постоянную цепочку test → immutable image → guarded Cloud.ru image-only deploy → production smoke. Во время внедрения photo flow PR #153/#154 сделали проверку deploy устойчивой к временному состоянию revisions API без `active`, сохранив проверку exact image, production template и полный smoke (`catalog`, auth guards, funnel v2). PR #159 также прошёл эту штатную цепочку.

## Current wall state

Read-only проверка после создания #66 вернула `total=3`:

- #64 — закреплён, `isPinned=true`;
- #66 — точный утверждённый текст, но `attachments=[]` до ручного добавления JPEG;
- #65 — предыдущая образовательная публикация.

#59/#60 ранее удалены вручную. #64 был закреплён вручную. Точный контент и статус #66 ведутся в `ops/vk/CONTENT.md`.
