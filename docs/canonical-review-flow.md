# Canonical ChatGPT review flow v1

## Цель

Этот контур связывает ручной/ChatGPT-разбор официального XLSX с каноническим серверным pipeline без повторного серверного парсинга XLSX и без ручной перекладки JSON администратором.

Рабочая цепочка:

`официальный XLSX → REVIEW_REQUIRED → ChatGPT semantic parse → canonical-reviewed/v1 → READY_TO_PUBLISH → canonical publication pipeline → существующий subscription URL`

## Источник истины

Watcher/ручной observer сначала сохраняет исходный XLSX и создаёт parser review со следующими обязательными привязками:

- `reviewId`;
- `sourceSha256`;
- `sourceKey`;
- `metadata.filename`;
- программа/факультет;
- курс;
- учебный год;
- семестр;
- диапазон групп, если он известен из официальной ссылки/источника.

ChatGPT не создаёт новую независимую карточку. Результат разбора отправляется **в существующий `reviewId`**, поэтому пакет нельзя незаметно подменить результатом от другого XLSX.

## Формат результата ChatGPT

Внешняя оболочка:

```json
{
  "format": "canonical-reviewed/v1",
  "rules_revision": "R69+canonical-v1",
  "batches": [
    { "schema_version": "1.0", "schedule": {}, "events": [] }
  ]
}
```

`batches` содержит полноценный `schedule-batch/v1` для каждой группы файла. События внутри соответствуют `schedule-event/v1`.

`system.event_id`, version metadata, `derived` и `calendar` до server pipeline остаются исходными/null согласно каноническому контракту.

## Проверка привязки к XLSX

`validateCanonicalReviewPackage()` выполняет до staging:

1. Проверяет формат `canonical-reviewed/v1` и `rules_revision`.
2. Проверяет 1–50 групповых batches.
3. Требует, чтобы `schedule.source_files` содержал точное имя XLSX из parser review.
4. Требует совпадение `event.source.file_name` с этим XLSX.
5. Если ChatGPT передал `source.file_hash`, он обязан совпадать с `review.sourceSha256`.
6. После проверки сервер сам записывает каждому событию авторитетный `source.file_hash = sha256:<review source SHA>`.
7. Проверяет университет, факультет/программу, курс, учебный год и семестр против metadata review.
8. Не разрешает два batch для одной группы.
9. Если review содержит `groupRange`, набор batches обязан **в точности** совпадать с этим диапазоном: пропущенная или лишняя группа блокирует staging.
10. Каждый batch проходит `validateScheduleBatch()` и должен иметь `publishable=true`.

Неизвестные паттерны, `needs_review`, некорректные пересечения и прочие blocking QA ошибки по-прежнему не проходят.

## Состояния review

### До разбора

`REVIEW_REQUIRED / MANUAL_NORMALIZATION_REQUIRED`

Текущая опубликованная версия расписания сохраняется.

### После успешной загрузки canonical-reviewed/v1

Та же карточка становится:

`READY_TO_PUBLISH / CANONICAL_REVIEWED_JSON_QA_PASS`

Для совместимости с существующим admin review router поле `parserType` остаётся `REVIEWED_JSON`, а новый формат однозначно отмечается:

```json
"normalizer": {
  "type": "chatgpt-reviewed",
  "rulesRevision": "...",
  "format": "canonical-reviewed/v1"
}
```

Существующая кнопка/endpoint `POST /api/v1/admin/parser-reviews/{reviewId}/publish` поэтому продолжает работать.

### После публикации

`PUBLISHED / CANONICAL_REVIEWED_JSON_PUBLISHED`

В review сохраняется результат по группам: version IDs, previous version IDs, fingerprints и diff.

## Публикация

Перед первой записью **все группы** проходят полный preflight:

`input QA → previous current read → versioning/diff → postprocessing → output QA → ICS generation`

Только после успешного preflight всех групп начинается запись в canonical storage через `YearAwareStore.putSchedule()`.

Для каждого опубликованного batch далее действует Step 7:

- immutable version object;
- `current.json` группы;
- стабильный `event_id`/ICS UID;
- revision/SEQUENCE;
- существующий tokenized subscription URL автоматически видит новую редакцию.

Логические/QA ошибки являются fail-closed и обнаруживаются до первой записи.

### Ошибка object storage во время много-групповой записи

Per-group `current.json` не образуют распределённую транзакцию. Поэтому редкий инфраструктурный отказ между переключениями нескольких групп теоретически может дать частичную публикацию. Такой случай не скрывается: publication останавливается и review переводится в `REVIEW_REQUIRED / CANONICAL_PUBLICATION_PARTIAL` с перечнем уже переключённых групп.

Это отличается от обычной validation failure: при validation failure ни одна группа не переключается.

## Admin HTTP API

Загрузка результата в существующий review:

`POST /api/v1/admin/parser-reviews/{reviewId}/canonical`

Авторизация: `x-admin-token`.

По умолчанию выполняется staging и возвращается `202 READY_TO_PUBLISH`.

Для staging + публикации одной операцией:

`POST /api/v1/admin/parser-reviews/{reviewId}/canonical?publish=true`

Также остаётся стандартная отдельная публикация:

`POST /api/v1/admin/parser-reviews/{reviewId}/publish`

## GitHub OIDC control plane

Чтобы ChatGPT/оператор не копировал canonical JSON вручную и не использовал admin-token, добавлен endpoint:

`POST /api/v1/schedule-review/control`

Он не принимает `x-admin-token`. Доступ подтверждается короткоживущим GitHub Actions OIDC JWT с:

- audience `kgmu-schedule-review`;
- repository `gmarkov634-stack/kirov-gmu-calendar`;
- actor `gmarkov634-stack`;
- event `pull_request`;
- ref вида `refs/pull/<n>/merge`.

Поддерживаемые команды:

- `review.submit` — загрузить canonical package и остановиться на `READY_TO_PUBLISH`;
- `review.submit_publish` — загрузить и сразу опубликовать;
- `review.publish` — опубликовать ранее staged review.

Команда живёт только в PR-файле:

`ops/schedule-review/command.json`

Workflow:

`.github/workflows/schedule-review-control.yml`

Workflow дополнительно разрешён только при `github.actor == gmarkov634-stack` и только для branch внутри исходного репозитория, не fork.

Таким образом, подключённый к GitHub ChatGPT может подготовить canonical package, создать служебную ветку/PR и инициировать безопасную публикацию без передачи секретов в чат или репозиторий.

## Пример control command

```json
{
  "id": "schedule-review-401-20260813-001",
  "action": "review.submit_publish",
  "createdAt": "2026-08-13T10:00:00.000Z",
  "reviewId": "123e4567-e89b-12d3-a456-426614174000",
  "package": {
    "format": "canonical-reviewed/v1",
    "rules_revision": "R69+canonical-v1",
    "batches": []
  }
}
```

Реальная команда обязана содержать непустой `batches`.

## Реализация

- `api/src/adapters/kgmu/canonical-reviewed.mjs` — проверка, staging и canonical publish adapter;
- `api/src/adapters/kgmu/reviewed-service.mjs` — lifecycle существующего review;
- `api/src/adapters/kgmu/http-handler.mjs` — admin canonical endpoint;
- `api/src/schedule-review-control.js` — OIDC control plane;
- `.github/workflows/schedule-review-control.yml` — GitHub→backend bridge;
- `api/src/schedule/pipeline.js` — canonical publication preflight;
- `api/src/year-aware-store.js` — version storage и current pointer.

## Regression

- `api/test/kgmu-canonical-review.test.js`;
- `api/test/kgmu-reviewed-http.test.js`;
- `api/test/schedule-review-control.test.js`;
- общие `schedule-pipeline`, validation, versioning, postprocessing, ICS и subscription regression tests.

Полный `.github/workflows/api-tests.yml` должен быть зелёным перед production deployment.
