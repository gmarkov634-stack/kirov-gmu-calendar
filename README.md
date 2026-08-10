# Medical university calendars

Платформа электронных расписаний и подписных календарей для медицинских вузов.

## Многовузовское ядро

Расписание идентифицируется контекстом:

```json
{
  "university": "omgmu",
  "program": "medicine",
  "course": 4,
  "stream": "2",
  "groupCode": "Л-402А",
  "groupId": "omgmu:medicine:4:stream-2:Л-402А"
}
```

Файлы расписаний хранятся по ключу:

```text
schedules/{university}/{program}/{course}/{encodedGroupId}.json
```

Основные маршруты API версии 2:

```text
POST /api/v2/payments
GET  /api/v2/meta
GET  /api/v2/schedules/{university}/{program}/{course}/{groupId}/schedule
GET  /api/v2/schedules/{university}/{program}/{course}/{groupId}/calendar.ics
```

Подписные ссылки сохраняют прежний внешний формат:

```text
GET /api/v1/subscriptions/{token}/calendar.ics
```

Но записи подписок используют схему версии 2 с полями `university`, `program`, `course`, `stream`, `groupCode`, `groupId`, `timezone`, `academicYear` и `semester`.

## VK Callback API

Интеграция сообщества VK принимает события на `POST /api/v1/vk/callback`. Для безопасного теста исходящих сообщений поддерживается только команда `/calendar-test`; обычные входящие сообщения не получают автоматического ответа.

Токены и секреты задаются только через переменные окружения и не должны храниться в репозитории.

## Тесты

```bash
cd api
npm test
```
