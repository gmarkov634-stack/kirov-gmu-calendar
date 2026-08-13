# Хранение и публикация расписания v1

## Назначение

Публикация — последний серверный этап перед тем, как новая редакция расписания становится видна существующим подписчикам.

Канонический pipeline:

`input validation → versioning/diff → postprocessing → output validation → ICS preflight → atomic publish`

Реализация:

- `api/src/schedule/pipeline.js` — подготовка и публикация канонического `schedule-batch/v1`;
- `api/src/schedule/publish-handler.js` — защищённый административный HTTP endpoint;
- `api/src/year-aware-store.js` — хранение immutable-версий и переключение current pointer;
- `api/src/order-context.js` — единый контекст старого и канонического форматов;
- `api/src/subscription-period.js` — срок семестровой подписки для canonical floating-time расписания.

## Публикационный контекст

Из `schedule-batch/v1` сервер получает:

- университет — `schedule.university_code`;
- программу/факультет — `schedule.faculty_code`;
- курс — `schedule.course`;
- группу — `schedule.group`;
- учебный год — `schedule.academic_year`;
- семестр — `autumn → 1`, `spring → 2`.

Для КГМУ группа 401 педиатрического факультета получает стабильный внутренний group ID вида:

`kgmu:pediatrics:4:401`.

## Pipeline

`prepareSchedulePublication()` выполняет последовательно:

1. Проверку, что получен `schedule-batch/v1` с полным контекстом публикации.
2. Входной `validateScheduleBatch()`.
3. Сопоставление с текущей опубликованной канонической редакцией через `versionSchedule()`.
4. Постобработку `postprocessSchedule()`.
5. Повторную `validatePostprocessedSchedule()`.
6. Пробную генерацию `buildScheduleIcs()`.

Если любой этап до публикации завершился ошибкой, текущая опубликованная версия не меняется.

`needs_review`, структурные ошибки, новые необъяснимые конфликты и нарушения derived-инвариантов остаются fail-closed.

## Immutable versions

Каждая каноническая редакция группы хранится отдельным неизменяемым объектом:

`/schedule-publications/{university}/{program}/{course}/{academic-year}/semester-{n}/{group-id}/versions/{schedule_version_id}.json`

Например:

`schedule-publications/kgmu/pediatrics/4/2026-2027/semester-1/kgmu%3Apediatrics%3A4%3A401/versions/ver_....json`

После записи version object его содержимое не должно изменяться. Повторное использование того же `schedule_version_id` с другим `content_fingerprint` считается нарушением неизменяемости и блокируется.

## Current pointer и атомарность

Текущая редакция определяется небольшим manifest:

`.../{group-id}/current.json`

Manifest содержит:

- `versionKey`;
- `scheduleVersionId`;
- `previousScheduleVersionId`;
- `contentFingerprint`;
- `publishedAt`;
- `eventCount`.

Порядок публикации:

1. записать immutable version object;
2. заменить `current.json`;
3. очистить серверный cache;
4. best-effort обновить compatibility mirrors старого storage layout.

**Единственной границей публикации для подписчиков является переключение `current.json`.** Если запись pointer не удалась, подписчики продолжают видеть предыдущую редакцию.

Compatibility mirrors записываются только после pointer switch и не участвуют в canonical subscriber read path.

## Идемпотентность

Если incoming содержимое полностью совпадает с текущим:

- сохраняется текущий `schedule_version_id`;
- новая immutable-версия не создаётся;
- `current.json` не переключается;
- publication result имеет `unchanged = true`.

## Подписной URL

Новый движок не создаёт отдельную пользовательскую ссылку.

Сохраняется существующий персональный endpoint:

`GET /api/v1/subscriptions/{token}/calendar.ics`

Он получает расписание через `YearAwareStore.getSchedule()`. Store сначала пытается прочитать canonical `current.json`, затем использует старые механизмы как compatibility fallback.

Поэтому после публикации новой версии студенту не нужно удалять и повторно импортировать календарь. При следующем обновлении подписки тот же URL возвращает текущий snapshot с теми же `UID` для сопоставленных занятий и увеличенным `SEQUENCE` для изменённых.

## Семестровая и годовая подписка

Для семестровой подписки конец действия определяется по последнему фактическому canonical событию. Floating wall-clock переводится в абсолютный момент с университетским UTC offset только для серверной проверки срока подписки; в ICS само время остаётся floating.

Если в canonical batch нет события с пригодным временем окончания, используется `schedule.period.end_date`.

Годовая подписка продолжает читать первый и второй семестр отдельно через `YearAwareStore` и объединять их в один feed.

## Administrative publish endpoint

Защищённый endpoint:

`POST /api/v1/admin/schedules/publish`

Авторизация: `x-admin-token`.

Тело запроса:

- непосредственно `schedule-batch/v1`; или
- `{ "batch": <schedule-batch> }`.

Успешный ответ содержит:

- статус `published` или `unchanged`;
- publication context;
- `scheduleVersionId` и `previousScheduleVersionId`;
- `contentFingerprint`;
- event count;
- размер пробного ICS;
- diff;
- входной и выходной QA reports;
- storage publication metadata.

Непубликуемый пакет возвращает conflict и не меняет current pointer.

## Совместимость

Старые расписания и старый `buildCalendar()` продолжают работать. `YearAwareStore` поддерживает последовательность чтения:

1. canonical publication pointer;
2. ранее существовавший atomic KGMU bundle;
3. legacy normalized/flat schedule storage.

Это позволяет мигрировать факультеты и группы на новый pipeline постепенно, не ломая уже выданные подписки.

## Regression и CI

Основные проверки:

- `api/test/schedule-pipeline.test.js` — первая публикация, обновление времени без смены event ID, идентичный повторный импорт, fail-closed pointer;
- `api/test/canonical-subscription.test.js` — новый canonical batch выдаётся через существующий tokenized subscription endpoint;
- `api/test/order-context.test.js` — canonical context/storage key;
- `api/test/subscription-period-canonical.test.js` — срок семестровой canonical подписки;
- `api/test/schedule-ics.test.js` — стабильное обновление ICS и RFC folding.

Полный workflow `.github/workflows/api-tests.yml` выполняет `npm test` на Node 22 и должен быть зелёным перед закрытием этапа.
