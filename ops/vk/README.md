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

`/api/v1/vk/oauth/callback` на первом этапе является receive-only boundary: он проверяет наличие `code`, `state` и `device_id`, но намеренно не логирует, не отображает, не сохраняет и не обменивает эти значения на токены.

`/api/v1/vk/oauth/start` — диагностический PKCE scope probe. Страница использует закреплённую официальную UMD-сборку `@vkid/sdk@2.6.1`, генерирует `state` и `codeVerifier` в браузере и запрашивает только `wall groups`. Цель этапа — подтвердить, что текущий VK ID принимает необходимые API scopes. Callback остаётся receive-only, поэтому даже успешная авторизация на этом этапе не сохраняет access/refresh token.

Причина поэтапности: текущий VK ID использует OAuth 2.1/PKCE и возвращает access + refresh token. После успешного scope probe нужно отдельно реализовать, протестировать и зафиксировать PKCE exchange/refresh storage strategy, а уже затем подключать токен к `wall.*`.

Защищённый ключ, сервисный ключ, access token и refresh token никогда не должны попадать в GitHub, command-файлы, issue/PR или логи.
