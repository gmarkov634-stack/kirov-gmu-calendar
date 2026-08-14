# ОмГМУ — аудит интеграции с общей платформой календарей

Дата аудита: 14.08.2026.

Статус: **ЗАВЕРШЁН**.

## Цель

Проверить, должен ли ОмГМУ развиваться как отдельный продукт или как новый university adapter уже существующей платформы КГМУ, и определить точную границу между университетским кодом и общим ядром.

## Итоговое архитектурное решение

ОмГМУ подключается как новый университет к существующей платформе. Отдельный backend, отдельная система оплаты, отдельный subscription engine, отдельный versioning или отдельный генератор ICS для ОмГМУ не создаются.

Граница университета проходит **до canonical `schedule-batch/v1`**:

```text
официальный источник
  -> university-specific discovery/versioning/snapshot
  -> university-specific parser + rules
  -> canonical schedule-batch/v1
  -> ОБЩЕЕ ЯДРО
       validation
       versioning/diff
       postprocessing
       ICS preflight/generation
       publication/storage
       catalog
       payment/order
       subscription feed
```

Код КГМУ и ОмГМУ остаётся раздельным внутри `api/src/adapters/kgmu/` и `api/src/adapters/omgmu/`. Изменения общего ядра должны быть additive/backward-compatible и проходить существующий regression suite КГМУ.

## Что уже является общим ядром и повторно не реализуется

Проверены текущие файлы `main`.

1. **Canonical contract** — `api/schemas/schedule-batch.schema.json` и `api/schemas/schedule-event.schema.json`. Контракт уже содержит `university.code`, академический контекст, аудиторию, floating timing, lesson/source/parse/derived/calendar и не привязан к КГМУ.
2. **Publication pipeline** — `api/src/schedule/pipeline.js`: input QA -> versioning/diff -> postprocessing -> output QA -> ICS preflight -> publish.
3. **Postprocessing** — `api/src/schedule/postprocess.js`: X из N, учебная неделя, следующее/последнее занятие, дневной прогресс, cycle/assessment metadata, title/description/location.
4. **Storage/publication** — `MultiUniversityStore` и `YearAwareStore`: canonical storage path содержит `university`; immutable versions и `current.json` работают независимо от конкретного вуза. KGMU-specific ветви сохранены только как legacy compatibility.
5. **Catalog** — `/api/v2/catalog/{university}/...` уже параметризован по университету.
6. **Payments/subscriptions** — `YooKassaService` использует общий `scheduleContext`, сохраняет university metadata в заказе/подписке и выбирает return URL по `universitySiteUrls`.
7. **Multi-university regression** — `api/test/multi-university-flow.test.js` уже проверяет ОмГМУ в `MultiUniversityStore`, выдачу floating-time ICS и checkout для произвольного кода группы.

Вывод: слой после canonical batch уже фактически multi-university-ready.

## Что остаётся специфичным для ОмГМУ

В `api/src/adapters/omgmu/` должны оставаться:

- discovery официальных страниц и PDF;
- download/immutable source snapshot;
- source identity/version detection `source_page + source_url + sha256`;
- выделение русского `source_part`;
- определение source profile;
- четыре подтверждённых parser profile: `weekly_grid`, `course_lecture_list`, `cycle_rotation_grid`, `combined_rotation_table`;
- применение правил O01–O72 и source-specific diagnostics/evidence;
- формирование canonical batch на границе adapter -> core.

Правила O01–O72 не становятся правилами общего ядра.

## Найденные разрывы текущей реализации

### 1. Исторические PDF parser'ы ещё выдают legacy flat schedule

Текущие `weekly-parser`, `fourth-parser` и `cycle-parser` формируют объекты вида `university/program/group/events[]` с полями `id/title/start/end` и ISO-временем `+06:00`. Это полезные regression/reference parser'ы, но не production boundary.

Production adapter должен выдавать `schedule-batch/v1`, где фактическое занятие представлено через `university`, `academic`, `audience`, `timing.time_mode = floating`, `lesson`, `source`, `parse`, `derived`, `calendar`.

### 2. У ОмГМУ существует параллельный путь публикации мимо общего Step 7

`api/src/adapters/omgmu/publish.mjs` и особенно `api/tools/omgmu-publish-s3.mjs` работают с legacy schedule и напрямую пишут/удаляют объекты `schedules/omgmu/...` в S3.

Этот путь минует canonical input QA, общий versioning/diff, postprocessing, output QA, ICS preflight и immutable `current.json` publication boundary. Поэтому он **не является production-целевым** после интеграции.

Отдельно опасно прямое удаление blocked schedule object: parse/source failure не должен удалять последнюю подтверждённую публикацию. Для ОмГМУ сохраняется тот же инвариант, что и для КГМУ: временное исчезновение или повреждение источника не означает пустое расписание.

### 3. `omgmu/quality.mjs` дублирует часть общего QA

Legacy quality checker работает с `id/title/start/end`, содержит period-specific проверки 2025/26 и не является заменой canonical `validateScheduleBatch`/`validatePostprocessedSchedule`.

Его допустимая будущая роль — только **source-specific diagnostics** до canonical boundary: счётчики, O-rule consistency, геометрические/структурные предупреждения и `needs_review`. Финальную publishability определяет общий canonical pipeline.

### 4. В parser'ах остаются source-specific hardcodes

Исторические реализации содержат жёсткие 2026 год/праздники, конкретные группы 485/486/585, program/semester, фиксированные layout offsets и местами `+06:00`.

При production-миграции metadata должны поступать из source manifest/university configuration, а время — передаваться в canonical floating form. Геометрические правила O16/O69 и fail-closed семантика должны реализовываться на adapter-слое, а не в core.

### 5. O01–O72 ещё не материализованы системно в canonical evidence

Production-события ОмГМУ должны переносить доказательства разбора в canonical поля:

- `parse.status`;
- `parse.rule_ids`;
- `parse.warnings`;
- `source.file_name`;
- `source.file_hash`;
- `source.references`;
- `source.raw_text`;
- нормализованные `lesson.discipline`, `lesson.type`, `lesson.locations`;
- floating `timing`.

Это должно выполняться в одной canonicalization boundary ОмГМУ, а не дублироваться в storage/payment/ICS слоях.

## Неблокирующий технический долг общего ядра

`api/src/order-context.js` пока содержит небольшой hardcoded `UNIVERSITY_DEFAULTS` для `kgmu`, `omgmu`, `pgmu`. В дальнейшем его можно связать с общим university registry, но для подключения ОмГМУ это не блокер и сейчас менять общий runtime ради этого не требуется.

## Зафиксированный migration path

1. Реализовать **OmGMU canonical adapter**: parsed `source_series` + source metadata -> canonical `schedule-batch/v1`.
2. Добавить один сквозной regression для одной группы ОмГМУ: parser/source-series -> canonical batch -> `prepareSchedulePublication()` -> input QA PASS -> versioning/postprocessing -> output QA PASS -> ICS.
3. После подтверждения boundary перевести на неё все четыре source profiles ОмГМУ.
4. Вывести `omgmu-publish-s3` из production path; публикацию выполнять только через общий `publishScheduleBatch`/`YearAwareStore`.
5. Подключить source-adapter/review orchestration ОмГМУ к runtime, не меняя KGMU adapters/watchers.
6. Провести ограниченный production E2E на одной группе ОмГМУ, затем масштабировать каталог групп.

## Инварианты

- КГМУ продолжает работать на существующем adapter/review/watcher контуре.
- ОмГМУ не импортируется в parser КГМУ и наоборот.
- Новый университет не создаёт вторую реализацию common core.
- Источник/parse failure не очищает существующий `current.json`.
- Автоматическая публикация невозможна при `needs_review`.
- Новые OmGMU-only поля не становятся обязательными для ранее валидного canonical события КГМУ без новой версии контракта.

## Проверка

Архитектурный аудит опирается на фактическую структуру `main`: canonical schemas, `schedule/pipeline.js`, `postprocess.js`, `MultiUniversityStore`, `YearAwareStore`, catalog, `YooKassaService`, `multi-university-flow.test.js`, а также текущие legacy `omgmu/publish.mjs`, `omgmu/quality.mjs` и `tools/omgmu-publish-s3.mjs`.

## Следующий шаг

**OmGMU canonical adapter + первый сквозной canonical regression.** До его завершения новые функции оплаты, подписок, storage или ICS специально для ОмГМУ не разрабатываются.
