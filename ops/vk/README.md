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

VK access token остаётся только в Cloud.ru и не передаётся в GitHub.
