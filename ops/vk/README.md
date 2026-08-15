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
