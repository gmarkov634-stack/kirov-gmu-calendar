# Schedule data contract v1

## Назначение

Этот контракт задаёт единый формат обмена расписанием между смысловым разбором исходного файла и серверной частью проекта «Календарь КГМУ».

Поток данных:

`XLSX/PDF → разбор по подтверждённым правилам → schedule-batch → валидация → versioning → постобработка → ICS`

## Базовый принцип

Один `event` — одно фактическое занятие конкретной группы в конкретную дату.

Повторяющиеся занятия заранее разворачиваются в отдельные события. Исходным представлением расписания не является RRULE.

## Слои события

- `source` — исходные сведения и трассировка до файла, листа и диапазона ячеек.
- core-поля (`university`, `academic`, `audience`, `timing`, `lesson`) — нормализованный смысл занятия.
- `parse` — статус разбора, применённые правила и предупреждения.
- `derived` — вычисляемые после полного разбора группы данные.
- `calendar` — производное пользовательское представление для ICS.
- `system` — серверные идентификаторы, fingerprints и метаданные ревизии.

## Время

`timing.time_mode` в версии 1.0 имеет значение `floating`.

Это означает: время отображается ровно как в опубликованном расписании и не пересчитывается из-за смены часового пояса устройства.

## Период расписания

`schedule.period` обязателен и содержит:

- `start_date`;
- `end_date`;
- `week1_start_date`.

`week1_start_date` используется как точка отсчёта для `derived.academic_week`.

## Метаданные версии расписания

После этапа versioning сервер заполняет:

- `schedule.schedule_version_id` — уникальный идентификатор фактической ревизии;
- `schedule.previous_schedule_version_id` — непосредственная предыдущая ревизия либо `null`;
- `schedule.content_fingerprint` — SHA-256 fingerprint смыслового содержимого группы;
- `schedule.version_created_at` — момент создания конкретной редакции расписания.

На входе от парсера эти поля могут отсутствовать или быть `null`.

Идентичный повторный импорт не создаёт новую ревизию и не меняет `version_created_at`. Если содержимое вернулось к старому состоянию после промежуточной редакции, создаётся новая ревизия с новым `schedule_version_id`, но прежним `content_fingerprint`.

## Типы занятий

`lesson.type.code`:

- `lecture`
- `practice`
- `seminar`
- `laboratory`
- `consultation`
- `exam`
- `credit`
- `physical_education`
- `other`
- `unknown`

`unknown` не подменяется автоматически другим типом. Значение `unknown` допустимо к публикации и само по себе не требует `needs_review`.

## Дополнительный нормализованный контекст

- `lesson.cycle_id` — идентификатор подтверждённого цикла либо `null`;
- `lesson.joint_groups` — явно указанные в исходнике группы совместного проведения.

Эти поля не должны заполняться догадками.

## Статусы парсинга

- `ok` — событие полностью соответствует подтверждённым правилам или может быть опубликовано без дополнительного разбора.
- `warning` — есть некритичное предупреждение.
- `needs_review` — остаётся реальная неоднозначность данных, которую нельзя безопасно представить без проверки.

Наличие `needs_review` блокирует автоматическую публикацию расписания. Сам по себе `lesson.type.code = unknown` не является основанием для `needs_review`.

## Подгруппы

- `scope = whole_group` → `subgroups = []`
- `scope = subgroups` → `subgroups` содержит одну или несколько подгрупп.

Одновременные разные занятия для разных подгрупп хранятся отдельными событиями.

## Производные поля

`derived` заполняется только после полного разбора группы и server-side versioning.

В него входят:

- `academic_week`;
- `sequence.index`, `sequence.total`, `sequence.bucket`;
- `next_same_event` и `is_last_same_event`;
- `day.index`, `day.total`, `day.remaining`, `day.next_event`, `day.gap_minutes`, `day.overlaps_next`;
- `cycle` при наличии подтверждённого `cycle_id`;
- `assessment` при наличии конкретной опубликованной формы контроля.

`sequence.bucket`:

- `lecture`
- `class`
- `assessment`
- `other`

`next_same_event.gap_days` хранит календарный интервал до следующего события той же дисциплины и типа.

Пересекающиеся по времени занятия допустимы и сохраняются как отдельные события. `day.overlaps_next` и отрицательный `gap_minutes` используются только для пользовательского описания фактического пересечения, а не как основание блокировки.

## Calendar layer

`calendar` содержит:

- `title`;
- `description`;
- `location`.

Эти значения являются производными и могут быть пересозданы без повторного парсинга исходного файла.

## System layer и идентификаторы события

При первичном разборе серверные поля могут быть `null`:

- `system.event_id`;
- `system.schedule_version_id`;
- `system.fingerprint`;
- `system.revision`;
- `system.created_at`;
- `system.updated_at`.

После versioning:

- `event_id` идентифицирует логическое занятие между редакциями;
- `system.schedule_version_id` указывает редакцию расписания, в которую входит событие;
- `system.fingerprint` вычисляется по semantic core и не зависит от `source`, `derived` или `calendar`;
- `system.revision` начинается с 1 и увеличивается только при фактическом изменении события;
- `system.created_at` фиксирует создание логического события;
- `system.updated_at` изменяется только при semantic change.

Если у существующего занятия изменилось время или другой редактируемый атрибут, сервер по возможности сохраняет `event_id`, чтобы изменение отражалось как `changed`, а не как `removed + added`.

ICS использует стабильный `event_id` как основу `UID`, а `system.revision` как основу `SEQUENCE = revision - 1`.

Подробности: `docs/versioning.md` и `docs/ics-generation.md`.

## Смысловая валидация поверх JSON Schema

Сервер дополнительно проверяет:

1. Для обычного события `start_time < end_time`.
2. При `all_day = false` начало и окончание заданы.
3. `whole_group` не содержит подгрупп.
4. `subgroups` содержит хотя бы одну подгруппу.
5. Любой явно выставленный `needs_review` запрещает автоматическую публикацию пакета.
6. `sequence.index <= sequence.total`.
7. Последнее одноимённое занятие имеет `next_same_event = null` и `is_last_same_event = true`.
8. `day.index <= day.total`, `day.remaining = day.total - day.index`.
9. Для последнего события дня `day.next_event = null`, `day.remaining = 0`.
10. Проверяется внутренняя согласованность `day.gap_minutes` и `day.overlaps_next`, но само пересечение занятий не является ошибкой.
11. Проверяются подозрительные дубликаты.
12. Все события пакета соответствуют метаданным группы, курса, семестра и учебного года в `schedule`.
13. Даты событий лежат в пределах `schedule.period`, кроме явно допустимых исключений, подтверждённых источником.
14. Перед ICS generation обязательны `schedule_version_id`, `version_created_at`, `event_id`, положительный `revision`, `created_at`, `updated_at` и заполненный `calendar.title`.

Серверный валидатор не выполняет специальную проверку `unknown → needs_review` и не ищет необъяснимые/неподтверждённые пересечения.

## Файлы

- `schemas/schedule-event.schema.json`
- `schemas/schedule-batch.schema.json`
- `examples/schedule-event.example.json`
- `examples/schedule-batch.example.json`
- `docs/postprocessing.md`
- `docs/schedule-validation.md`
- `docs/versioning.md`
- `docs/ics-generation.md`

Версия контракта: `1.0`.
