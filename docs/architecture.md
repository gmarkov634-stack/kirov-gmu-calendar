# Архитектура проекта «Календарь КГМУ»

## Граница ответственности

ChatGPT выполняет смысловой разбор исходных XLSX/PDF по подтверждённым правилам и формирует нормализованный `schedule-batch`.

Сервер валидирует данные, назначает идентификаторы и версии, выполняет постобработку, сравнивает версии, генерирует ICS и публикует обновления. Неизвестный паттерн получает `needs_review` и блокирует автоматическую публикацию.

## Статус этапов

### Шаг 2 — единый JSON-формат события
Статус: **завершён**.

Утверждены `schedule-event/v1`, `schedule-batch/v1`, floating-время, разделение source/core/derived/calendar, статусы парсинга и серверный versioning.

Подробности: `docs/schedule-data-contract.md`.

### Шаг 3 — общая постобработка
Статус: **завершён**.

Реализованы X из N, учебная неделя, следующее/последнее занятие, циклы, формы контроля, дневной прогресс, интервалы, подгруппы, location, подпись сервиса и промо-события.

Код: `api/src/schedule/postprocess.js`.
Спецификация: `docs/postprocessing.md`.

### Шаг 4 — серверная валидация
Статус: **завершён**.

Реализованы JSON Schema validation, смысловые проверки, блокировка needs_review, дубликаты, пересечения, R69, подгруппы, проверка derived/calendar и QA-отчёт publishable.

Код: `api/src/schedule/json-schema-validator.js`, `api/src/schedule/validate.js`.
Спецификация: `docs/schedule-validation.md`.

### Шаг 5 — versioning и diff
Статус: **завершён**.

Реализованы стабильный `event_id`, fingerprints, уникальные версии расписания, цепочка предыдущих версий, `system.revision`, `created_at`, `updated_at`, идемпотентный повторный импорт, история A → B → A и diff `added / changed / removed / unchanged`.

Код: `api/src/schedule/versioning.js`.
Спецификация: `docs/versioning.md`.

### Шаг 6 — генерация ICS
Статус: **завершён**.

Реализованы:
- канонический `schedule-batch → ICS`;
- стабильный `UID` на базе `event_id`;
- `SEQUENCE = revision - 1`;
- стабильные `CREATED`, `DTSTAMP`, `LAST-MODIFIED`;
- floating `DTSTART/DTEND` без `TZID`, `VTIMEZONE` и UTC-конвертации;
- корректный all-day;
- escaping и UTF-8 folding до 75 октетов;
- детерминированная выдача одной версии;
- version metadata и refresh hints;
- удалённые события отсутствуют в актуальном snapshot-feed;
- отказ от генерации неversioned/неpostprocessed событий;
- совместимость через существующий `buildCalendar()`.

Код: `api/src/schedule/ics.js`, adapter `api/src/calendar.js`.
Regression: `api/test/schedule-ics.test.js`, `api/test/schedule-versioning.test.js`.
Спецификация: `docs/ics-generation.md`.

Точечная Node-проверка нового ICS-модуля подтвердила корректные UID/DTSTART/SEQUENCE и максимальную длину folded physical line 75 UTF-8 октетов. Отдельный GitHub Actions test workflow пока не подключён; текущая автоматизация репозитория выполняет Pages deployment.

### Следующий этап

Шаг 7 — хранение и публикация версий расписания: единый pipeline `validate → version → postprocess → validate → ICS → publish`, хранение текущей и предыдущих версий группы и стабильная серверная точка выдачи подписного ICS.
