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

### Шаг 7 — хранение и публикация
Статус: **завершён**.

Реализованы:
- единый pipeline `input validation → versioning/diff → postprocessing → output validation → ICS preflight → publish`;
- чтение текущей канонической редакции перед versioning;
- immutable version object для каждой фактической редакции группы;
- отдельный `current.json` как единственная атомарная граница переключения подписчиков;
- защита от повторного использования `schedule_version_id` с другим содержимым;
- идемпотентная повторная публикация без лишней версии;
- compatibility fallback к ранее существовавшим bundle/legacy schedule storage;
- поддержка canonical `schedule-batch` в `scheduleContext`;
- canonical semester expiry с учётом floating wall-clock;
- объединение двух canonical семестров для годовой подписки;
- защищённый `POST /api/v1/admin/schedules/publish`;
- сохранение существующего персонального `GET /api/v1/subscriptions/{token}/calendar.ics` без смены пользовательской ссылки;
- существующий subscription URL автоматически начинает отдавать текущую canonical редакцию после переключения pointer.

Код: `api/src/schedule/pipeline.js`, `api/src/schedule/publish-handler.js`, `api/src/year-aware-store.js`, `api/src/order-context.js`, `api/src/subscription-period.js`.
Regression: `api/test/schedule-pipeline.test.js`, `api/test/canonical-subscription.test.js`, `api/test/subscription-period-canonical.test.js`, `api/test/order-context.test.js`.
Спецификация: `docs/schedule-publication.md`.

Полный GitHub Actions workflow `.github/workflows/api-tests.yml` на актуальном коде завершился успешно. Перед зелёным прогоном был обнаружен и исправлен ложный assertion в ICS folding regression: проверка логического TEXT теперь выполняется после unfolding, а физическое ограничение 75 UTF-8 октетов остаётся отдельной проверкой.

### Следующий этап

Шаг 8 — связать подтверждённый результат ручного/ChatGPT-разбора расписания с каноническим publication pipeline: из approved review получать `schedule-batch/v1`, публиковать его без ручного POST JSON, сохранять diff/QA для администратора и провести end-to-end тест `исходник → review → publish → существующая подписка → обновлённый ICS`.
