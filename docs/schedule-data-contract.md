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
- `schedule.content_fingerprint` — SHA-256 fingerprint смыслового содержимого группы.

На входе от парсера эти поля могут отсутствовать или быть `null`.

Идентичный повторный импорт не создаёт новую ревизию. Если содержимое вернулось к старому состоянию после промежуточной редакции, создаётся новая ревизия с новым `schedule_version_id`, но прежним `content_fingerprint`.

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

`unknown` не подменяется автоматически другим типом и требует проверки.

## Дополнительный нормализованный контекст

- `lesson.cycle_id` — идентификатор подтверждённого цикла либо `null`;
- `lesson.joint_groups` — явно указанные в исходнике группы совместного проведения.

Эти поля не должны заполняться догадками.

## Статусы парсинга

- `ok` — событие полностью соответствует подтверждённым правилам.
- `warning` — есть некритичное предупреждение.
- `needs_review` — неизвестный или неоднозначный паттерн.

Наличие `needs_review` блокирует автоматическую публикацию расписания.

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

## Calendar layer

`calendar` содержит:

- `title`;
- `description`;
- `location`.

Эти значения являются производными и могут быть пересозданы без повторного парсинга исходного файла.

## Идентификаторы события

При первичном разборе:

- `event_id = null`
- `system.schedule_version_id = null`
- `fingerprint = null`

Сервер назначает значения при импорте и сопоставлении с предыдущей версией.

`event_id` сохраняется при однозначном сопоставлении логического занятия между редакциями. `system.fingerprint` вычисляется по semantic core события и не зависит от `source`, `derived` или `calendar`.

Если у существующего занятия изменилось время или другой редактируемый атрибут, сервер по возможности сохраняет `event_id`, чтобы изменение отражалось как `changed`, а не как `removed + added`.

Подробности: `docs/versioning.md`.

## Смысловая валидация поверх JSON Schema

Сервер дополнительно проверяет:

1. Для обычного события `start_time < end_time`.
2. При `all_day = false` начало и окончание заданы.
3. `whole_group` не содержит подгрупп.
4. `subgroups` содержит хотя бы одну подгруппу.
5. `lesson.type.code = unknown` требует `parse.status = needs_review`.
6. Любой `needs_review` запрещает автоматическую публикацию пакета.
7. `sequence.index <= sequence.total`.
8. Последнее одноимённое занятие имеет `next_same_event = null` и `is_last_same_event = true`.
9. `day.index <= day.total`, `day.remaining = day.total - day.index`.
10. Для последнего события дня `day.next_event = null`, `day.remaining = 0`.
11. При `day.overlaps_next = true` значение `gap_minutes` отрицательное.
12. Проверяются подозрительные дубликаты и необъяснимые пересечения.
13. Все события пакета соответствуют метаданным группы, курса, семестра и учебного года в `schedule`.
14. Даты событий лежат в пределах `schedule.period`, кроме явно допустимых исключений, подтверждённых источником.

## Файлы

- `schemas/schedule-event.schema.json`
- `schemas/schedule-batch.schema.json`
- `examples/schedule-event.example.json`
- `examples/schedule-batch.example.json`
- `docs/postprocessing.md`
- `docs/schedule-validation.md`
- `docs/versioning.md`

Версия контракта: `1.0`.
