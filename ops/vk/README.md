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

Интеграция использует два разных токена и не подменяет один другим:

- `VK_ACCESS_TOKEN` — токен сообщества для Callback API и сообщений;
- `VK_USER_ACCESS_TOKEN` — пользовательский токен администратора для чтения и управления стеной (`wall.*`).

Если `VK_USER_ACCESS_TOKEN` отсутствует, endpoints стены работают fail-closed и возвращают `503`, даже если `VK_ACCESS_TOKEN` сообщества настроен.

Оба токена остаются только в Cloud.ru и не передаются в GitHub. Сами значения токенов никогда не должны попадать в репозиторий, command-файлы или логи.

## VK ID OAuth

Зарегистрировано отдельное Web-приложение VK ID для административной авторизации стены:

- public Client ID: `54722093`;
- base domain: `kgmu-calendar-api.containerapps.ru`;
- trusted redirect URL: `https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback`.

`/api/v1/vk/oauth/start` — диагностическая стартовая страница без client-side JavaScript. `/api/v1/vk/oauth/begin` создаёт свежие `state` и PKCE verifier/challenge на сервере, сохраняет state/verifier только в короткоживущих `HttpOnly; Secure; SameSite=Lax` cookie и перенаправляет в VK ID с минимальным scope `wall groups`.

`/api/v1/vk/oauth/callback` проверяет обязательные параметры и совпадение `state`, обменивает одноразовый authorization code на пользовательский token через OAuth 2.1/PKCE и сразу выполняет диагностический `wall.get` для `VK_CALLBACK_GROUP_ID`. Access token и refresh token на этом этапе не отображаются и не сохраняются; после проверки probe-cookie удаляются.

Цель exchange probe — доказать совместимость выданного VK ID user token с legacy `wall.*` API до выбора постоянного secret/refresh storage. Только после успешного `wall.get` разрешается переходить к постоянному хранению/обновлению токена и подключению его к production `wall.list/post/edit/delete/pin/unpin`.

Защищённый ключ, сервисный ключ, access token и refresh token никогда не должны попадать в GitHub, command-файлы, issue/PR или логи.
