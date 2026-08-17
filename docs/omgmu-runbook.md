# ОмГМУ — operations runbook

Дата актуализации: 17.08.2026.

Цель: зафиксировать единый operational flow ОмГМУ до и после появления расписания 2026/2027. Runbook не даёт права обходить canonical/review/launch gates.

## 1. Нормальное состояние до публикации 2026/27

Ожидаемо:

- `docs/omgmu-parser-coverage.md`: known profiles historical = ready;
- structural readiness workflow = PASS;
- `/api/v2/status/omgmu-watcher`: `sourceState = WAITING_SOURCE`;
- current-period sellable catalog пуст для неопубликованных групп;
- `COMMERCIAL_SALES_ENABLED` не открывается из watcher/review;
- historical fixtures не используются как current offer.

Это нормальное ожидание внешнего source, а не ошибка системы.

## 2. Сценарий A — появился новый официальный PDF 2026/2027 autumn

Автоматический слой:

1. Source watcher проверяет официальный раздел.
2. Period gate должен подтвердить exact `2026/2027 + autumn`.
3. PDF скачивается как exact bytes, считается SHA-256.
4. Source сохраняется в `parser-staging/omgmu/sources/<sha>/<filename>`.
5. Создаётся source-bound review со статусом `REVIEW_REQUIRED`.
6. Current publication, catalog и sales не меняются.

Проверка оператора:

- `/api/v2/status/omgmu-watcher` должен перейти в `REVIEW_REQUIRED`;
- в admin review queue должен появиться новый review;
- filename, SHA, program/course/stream/part/year/semester должны соответствовать источнику.

Дальше:

- ChatGPT выполняет semantic review exact PDF;
- если profile известен и структура совместима — строится `canonical-reviewed/v1`;
- если profile новый/неоднозначный — сначала фиксируются новые правила, fixtures и regression;
- `review.submit` только staging/QA;
- publication выполняется отдельной `review.publish` либо контролируемым `review.submit_publish` только после полного QA и соблюдения launch gate.

## 3. Сценарий B — известный URL изменил SHA

Ожидаемое поведение:

1. Watcher видит тот же source slot, но новый SHA.
2. Создаётся новый review candidate (`CHANGED_REVIEW_REQUIRED`).
3. Старый current остаётся доступен.
4. Новый PDF не считается «тем же расписанием» автоматически.

Действия:

- сравнить exact source evidence старой и новой версии;
- заново выполнить semantic review;
- проверить group completeness и canonical diff;
- публикация только после QA;
- после publication проверить стабильность UID, корректность revision/SEQUENCE и тот же subscription URL.

Запрещено:

- заменять current прямо из watcher;
- считать изменение SHA косметическим без review;
- удалять события только потому, что их нет в невалидной/неполной новой версии.

## 4. Сценарий C — появился неизвестный structural format

Симптомы:

- source profile не определяется однозначно;
- существующий parser требует догадки;
- ownership строк/групп/дат/времени не доказан source evidence.

Действия:

1. Оставить source в `REVIEW_REQUIRED`.
2. Не расширять старый parser по визуальной аналогии без отдельного правила.
3. Зафиксировать новый structural profile либо строгое расширение существующего profile.
4. Добавить source-bound fixture/geometry/evidence.
5. Добавить fail-closed правила для неоднозначностей.
6. Добавить canonical regression и при необходимости historical/golden anchor.
7. Прогнать `npm run readiness:omgmu`.
8. Только после PASS вернуться к review конкретного PDF.

Любой unresolved case = publication blocked.

## 5. Сценарий D — источник исчез / 404 / 5xx / network error

Ожидаемое поведение:

- watcher возвращает diagnostic-only состояние;
- last observed SHA/review сохраняются;
- last-known-good current schedule не меняется;
- subscription URL продолжает отдавать последнюю опубликованную версию;
- автоматического удаления publication нет.

Действия:

- проверить `/api/v2/status/omgmu-watcher` и `lastRun.errorCount/missingCount`;
- подтвердить, что current catalog/subscription не изменились;
- повторно проверять официальный источник обычным watcher cycle;
- если университет перенёс PDF на новый URL, новый source должен пройти обычный exact-source review boundary.

Запрещено вручную очищать current только из-за недоступности source page.

## 6. Сценарий E — source review готов к публикации

Перед publication проверить:

- exact PDF filename + SHA совпадают с review;
- context совпадает: `university=omgmu`, academic year, semester, program, course, stream/group;
- полный group batch собран из всех обязательных source parts;
- input QA = PASS;
- postprocessing = PASS;
- output QA = PASS;
- ICS preflight = PASS;
- нет `needs_review`;
- provenance ведёт к reviewed source.

Команды review control разделены:

- `review.submit` — сохранить canonical package и перевести review в `READY_TO_PUBLISH`, current не меняется;
- `review.publish` — explicit publication уже подготовленного review;
- `review.submit_publish` — объединённая операция, допустима только в контролируемом review workflow и не должна использоваться watcher-ом.

Endpoint: `/api/v1/schedule-review/control`; доступ защищён GitHub OIDC и разрешён только доверенному review workflow.

## 7. Сценарий F — current-period publication выполнена

Проверить:

1. current pointer читает новую schedule version;
2. точная группа появилась в live catalog;
3. `groupId/groupCode/course/stream` сохранены без реконструкции;
4. preview/current-period subscription отдаёт ожидаемый ICS;
5. controlled update отражается на том же URL;
6. UID неизменённого/изменяемого logical event стабилен, revision/SEQUENCE корректны;
7. rollback/idempotent republish безопасны.

Только после этого можно переходить к payment/fulfillment gate.

## 8. Сценарий G — подготовка к открытию продаж

Порядок:

1. current source + semantic coverage PASS;
2. canonical publication PASS;
3. live catalog identity PASS;
4. current-period subscription smoke PASS;
5. controlled OmGMU payment → succeeded order → paid subscription PASS;
6. paid subscription получает update без повторного импорта;
7. watcher/recovery healthy;
8. tenant isolation PASS;
9. landing mobile/payment-return smoke PASS;
10. только отдельным действием открыть commercial sales gate.

Watcher, parser, review submit и publication сами не включают продажи.

## 9. Быстрая диагностика

### Structural readiness

GitHub Actions: `.github/workflows/omgmu-launch-readiness.yml`.

Локальная/CI команда:

`npm run readiness:omgmu`

Ожидаемый статус до source:

`STRUCTURALLY_READY_CURRENT_DATA_WAITING`.

### Watcher status

Read-only endpoint:

`GET /api/v2/status/omgmu-watcher`

Ключевые поля:

- `sourceState`;
- `lastRun.targetCount`;
- `lastRun.newReviewCount`;
- `lastRun.changedReviewCount`;
- `lastRun.missingCount`;
- `lastRun.errorCount`;
- `reviews.reviewRequired`;
- `reviews.readyToPublish`;
- `reviews.published`;
- `publicationMode = explicit-only`.

### Admin review

- `POST /api/v1/admin/omgmu/watch` — ручной запуск server watcher при необходимости;
- `GET /api/v1/admin/omgmu/parser-reviews` — список review;
- `GET /api/v1/admin/omgmu/parser-reviews/<id>` — конкретный review;
- `GET /api/v1/admin/omgmu/parser-reviews/<id>/source` — exact PDF.

Admin routes требуют admin token. Semantic submit/publish идёт через общий OIDC-protected schedule review control.

## 10. Инварианты, которые нельзя нарушать

- `source watch != parser != publication != sales`;
- exact source identity = URL/filename/SHA + academic context;
- unknown ambiguity → review, не guess;
- historical fixture != current offer;
- partial source != full group publication;
- current меняется только после successful canonical QA;
- source disappearance не удаляет last-known-good;
- subscription URL сохраняется при обновлении;
- OmGMU tenant не наследует KGMU credentials/data;
- коммерческий gate открывается только после `docs/omgmu-launch-gate.md`.