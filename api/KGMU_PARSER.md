# КГМУ: серверный парсер и очередь ручной проверки

## Назначение

Слой предназначен для безопасного внедрения автоматического парсинга XLSX Кировского ГМУ в тот же API, который обслуживает семестровые и годовые подписки.

Главный принцип: **новый XLSX никогда не заменяет опубликованное расписание до успешного парсинга и QA**. Если структура неизвестна или правило ещё не перенесено в код, API создаёт `REVIEW_REQUIRED`, сохраняет исходник и оставляет текущие календари покупателей без изменений.

## Поток данных

```text
XLSX КГМУ
  -> structural XLSX reader (cells + native merged ranges)
  -> classifier R / C / S / UNKNOWN
  -> parser staging
  -> QA
  -> PASS -> published schedules/... -> subscription ICS
  -> REVIEW_REQUIRED -> parser-reviews/... + Telegram владельцу
```

На первом этапе в код перенесён классификатор и control plane. Парсеры `R`, `C` и `S` пока намеренно имеют статус `PARSER_*_NOT_ENABLED`: их следует включать по одному после переноса подтверждённых правил и регрессионных тестов на эталонных исходных XLSX.

## Типы

- `R` — недельная сетка по дням недели и группам.
- `C` — цикловая сетка: строки групп, столбцы конкретных календарных дат.
- `S` — смешанная недельно-цикловая структура.
- `UNKNOWN` — сигнатура не соответствует известному типу; автоматическая публикация запрещена.

## Хранилище

В том же S3/Object Storage используются отдельные префиксы:

```text
parser-staging/kgmu/sources/<sha256>/<filename>.xlsx
parser-reviews/kgmu/<review-id>.json
```

Опубликованные расписания продолжают храниться отдельно в `schedules/...`. Поэтому staging/review не может сам по себе изменить активную подписку.

## Admin API

Все маршруты требуют `X-Admin-Token`.

### Загрузить XLSX на классификацию

```text
POST /api/v1/admin/kgmu/ingest?filename=1_lech.xlsx&program=medicine&course=1&academicYear=2026%2F27&semester=1
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
X-Admin-Token: <ADMIN_TOKEN>

<binary XLSX body>
```

Ответ `202` содержит `reviewId`, SHA-256 исходника, тип `R/C/S/UNKNOWN`, причину и признак `publicationBlocked: true`.

### Список review

```text
GET /api/v1/admin/parser-reviews?status=REVIEW_REQUIRED&limit=100
X-Admin-Token: <ADMIN_TOKEN>
```

### Одна карточка

```text
GET /api/v1/admin/parser-reviews/<review-id>
X-Admin-Token: <ADMIN_TOKEN>
```

## Telegram

Переменные контейнера:

```text
TELEGRAM_BOT_TOKEN=<token отдельного или существующего служебного бота>
TELEGRAM_ADMIN_CHAT_ID=<chat id владельца>
KGMU_XLSX_MAX_BYTES=26214400
```

Если Telegram не настроен, review всё равно сохраняется в Object Storage; API только помечает уведомление как `telegram_not_configured`.

Сообщение содержит review ID, файл, учебный период, распознанный тип, причину и группы, найденные классификатором. Оно явно сообщает, что автопубликация остановлена, а текущее расписание подписчиков сохранено.

## Семестровая и годовая подписка

Семестровая ссылка получает опубликованное расписание своего семестра.

Годовая ссылка теперь собирает опубликованные `semester-1` и `semester-2` одного учебного года. Если пока опубликован только один семестр, ссылка работает с ним. После появления второго семестра он автоматически добавляется в тот же ICS при следующем обновлении клиентом — новый токен и повторный импорт не нужны.

## Следующий этап

1. Перенести общие правила G в общий нормализатор и QA.
2. Перенести `R01–R66` и включить parser `R` после regression fixtures.
3. Перенести `C01–C13`, затем `S01–S07`.
4. Добавить publish transition: только `QA PASS` может писать в versioned `schedules/...`.
5. После этого подключить мониторинг официального сайта КГМУ к `/admin/kgmu/ingest` или к эквивалентному внутреннему worker-процессу.
