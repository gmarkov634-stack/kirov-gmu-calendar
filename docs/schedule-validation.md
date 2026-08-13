# Серверная валидация расписания v1

## Назначение

Шаг валидации стоит между нормализованным `schedule-batch` и последующими серверными этапами. Он не исправляет данные и не интерпретирует исходный XLSX/PDF, а только проверяет, можно ли безопасно продолжать автоматическую обработку и публикацию.

Реализация:

- `api/src/schedule/json-schema-validator.js` — проверка JSON Schema 2020-12 в используемом проектом подмножестве ключевых слов;
- `api/src/schedule/validate.js` — смысловые проверки и итоговый QA-отчёт;
- `api/test/schedule-validation.test.js` — regression-тесты.

## Два этапа проверки

### 1. Input validation

`validateScheduleBatch(batch)` применяется к нормализованному пакету до versioning и постобработки.

Проверяются:

- `schedule-batch.schema.json` и `schedule-event.schema.json`;
- совпадение группы, курса, факультета, семестра, учебного года и вуза между `schedule` и всеми `events`;
- наличие корректного времени у timed events;
- `start_time < end_time`;
- соответствие `whole_group / subgroups`;
- правило `unknown → needs_review`;
- отсутствие событий за пределами `schedule.period`;
- дубликаты;
- необъяснимые пересечения.

### 2. Postprocessed validation

`validatePostprocessedSchedule(batch)` повторяет базовые проверки и дополнительно проверяет производные поля:

- `sequence.index <= sequence.total`;
- согласованность `is_last_same_event` и `next_same_event`;
- `day.index <= day.total`;
- `day.remaining = day.total - day.index`;
- у последнего занятия дня `next_event = null` и `remaining = 0`;
- отрицательный `gap_minutes` допустим только вместе с `overlaps_next = true`;
- корректность `cycle.index / total / is_first / is_last`;
- наличие `calendar.title` и `calendar.description` после постобработки.

## Статус публикации

Каждая проверка возвращает отчёт:

```json
{
  "stage": "input",
  "valid": true,
  "publishable": true,
  "errors": [],
  "warnings": [],
  "stats": {
    "events": 42,
    "needs_review": 0,
    "duplicates": 0,
    "overlaps": 1,
    "confirmed_overlaps": 1,
    "errors": 0,
    "warnings": 1
  }
}
```

`publishable = false`, если имеется хотя бы одна blocking error.

`assertSchedulePublishable()` предназначен для серверного pipeline: при блокирующей ошибке он выбрасывает `SCHEDULE_NOT_PUBLISHABLE` и прикладывает полный `report`.

## Blocking error codes

- `SCHEMA_VALIDATION` — нарушение JSON Schema;
- `BATCH_METADATA_MISMATCH` — событие относится не к метаданным пакета;
- `MISSING_TIME` — у обычного события нет полного временного интервала;
- `INVALID_TIME_RANGE` — начало не раньше окончания;
- `WHOLE_GROUP_WITH_SUBGROUPS`;
- `SUBGROUP_SCOPE_EMPTY`;
- `UNKNOWN_TYPE_NOT_REVIEWED`;
- `NEEDS_REVIEW`;
- `DATE_OUTSIDE_PERIOD`;
- `DUPLICATE_EVENT`;
- `UNCONFIRMED_OVERLAP`;
- ошибки согласованности `sequence`, `day`, `cycle` и `calendar` на postprocessed stage.

## Пересечения

Пересечение двух событий одной группы и дня автоматически не удаляется и не исправляется.

- Если оба события имеют подтверждённое правило `R69`, пересечение сохраняется и выдаётся warning `CONFIRMED_OVERLAP`.
- Если подтверждения нет, выдаётся blocking error `UNCONFIRMED_OVERLAP`.
- Если одновременно идут разные события для непересекающихся подгрупп одной группы, это не считается конфликтом.

Таким образом сервер не уничтожает официально опубликованное пересечение, но и не пропускает новый неизвестный конфликт молча.

## Дубликаты

Подозрительный дубль определяется по совокупности:

- группа;
- дата;
- начало и окончание;
- нормализованная дисциплина;
- тип занятия;
- подтверждённое место;
- подгруппа.

При совпадении создаётся `DUPLICATE_EVENT` и автоматическая публикация блокируется до исправления/проверки данных.

## JSON Schema validator

Проект не добавляет отдельную npm-зависимость только ради двух собственных схем. Встроенный валидатор реализует используемые этими схемами ключевые слова:

- `$ref`;
- `type`;
- `const`;
- `enum`;
- `anyOf`;
- `required`;
- `properties`;
- `additionalProperties`;
- `items`;
- `minItems`;
- `uniqueItems`;
- `minLength`;
- `pattern`;
- `minimum / maximum`;
- `format: date / date-time`.

При расширении схем новым JSON Schema keyword сначала добавляется его поддержка в validator и regression-тест.

## Принцип безопасности

Валидатор не исправляет событие автоматически. Его результат — либо разрешение продолжить pipeline, либо точный отчёт с путём к проблемному полю и идентификатором/индексом события.
