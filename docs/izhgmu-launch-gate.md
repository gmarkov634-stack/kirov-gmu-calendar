# ИжГМУ — launch gate

Статус: **BACKEND DEPLOYED / CURRENT DATA WAITING / SALES CLOSED**

Дата фиксации: 2026-08-17.

Этот документ определяет текущую границу запуска Ижевского ГМУ. Historical spring 2025/2026 доказывает parser/canonical механику, но не является текущим offer.

## Active launch scope

- university: `izhgmu`;
- program: `medicine`;
- courses: `1,2,3`;
- target academic year: `2026/2027`;
- target semester: `autumn`;
- medicine 4–6: `DEFERRED`;
- pediatrics/dentistry: вне initial commercial scope.

## Gate A — exact current source

GitHub Actions workflow `.github/workflows/izhgmu-source-watch.yml` ежечасно выполняет официальный acquisition через `www.igma.ru` и выбирает только exact target `medicine + courses 1–3 + 2026/2027 + autumn`.

Здоровые состояния до появления источника:

- `waiting`: exact target отсутствует;
- `review-required`: target ссылки появились, но source set загружен/валидирован не полностью;
- `candidate`: все exact target source members скачаны и имеют SHA-256.

`waiting`, download error, исчезновение ссылки или metadata conflict никогда не меняют `current` и не являются инструкцией удалить расписание.

## Gate B — immutable source-set identity

Current source candidate определяется не URL/filename по отдельности, а digest полного набора:

`SHA-256(sort(source_url + NUL + file_sha256))`.

Review сохраняет exact members: URL, filename, SHA-256 и metadata. Изменение любого member SHA создаёт новую source-set identity и требует нового review.

## Gate C — source-bound review

При `candidate` watcher сохраняет immutable observation artifact и создаёт дедуплицированную GitHub issue. Workflow не выполняет semantic parsing и не публикует расписание.

Protected GitHub OIDC control поддерживает отдельный `review.create` для ИжГМУ. Он создаёт только `REVIEW_REQUIRED` и принимает только active scope `medicine 1–3 / 2026/2027 / autumn`.

## Gate D — ChatGPT semantic review + canonical QA

После смыслового разбора формируется `canonical-reviewed/v1` с обязательным `source_set_digest`.

Для каждого `schedule-batch/v1` проверяется:

- university/program/course/current period;
- все `schedule.source_files` входят в reviewed source set;
- каждый event имеет `source.file_name` из reviewed set;
- event `source.file_hash` exact совпадает с SHA соответствующего source member;
- общий `validateScheduleBatch()` = publishable;
- duplicate group identity отсутствует.

Shared `schedule-event/v1` и `schedule-batch/v1` ради source-set binding не расширяются: digest является свойством reviewed envelope, а provenance остаётся в существующих source-полях событий.

Historical `2025/2026` и medicine course 4–6 current boundary отклоняет fail-closed.

## Gate E — explicit publication only

`review.submit` переводит review только в `READY_TO_PUBLISH`; `current` при этом не меняется.

Публикация выполняется только отдельной `review.publish` / `review.submit_publish` через существующий OIDC-protected `/api/v1/schedule-review/control`.

Перед каждой записью используется общий pipeline:

`previous current → input QA → versioning/diff → postprocessing → output QA → ICS preflight → YearAwareStore.putSchedule()`.

Source watcher не имеет publication route и не имеет доступа к sales/trial/catalog activation.

## Gate F — live catalog / subscription smoke

После explicit publication текущей группы необходимо подтвердить exact group identity в live catalog, текущий `2026/2027 autumn` schedule в storage, персональный subscription URL и controlled update A→B→A на том же URL со стабильным UID/ростом SEQUENCE и rollback к baseline.

## Gate G — payment / fulfillment

Только после current-period subscription smoke выполняется controlled ИжГМУ payment/fulfillment E2E:

`checkout → YooKassa test payment → payment.succeeded → paid subscription → backend-issued URL → ICS`.

University commercial gate должен оставаться закрытым вне специально контролируемого E2E.

## Gate H — launch authorization

Публичный launch допускается только после одновременного PASS обязательных gates A–G и отдельного явного решения открыть нужные product gates.

До этого сохраняются:

- `izhgmu.active=false`;
- catalog unavailable;
- university commercial gate closed;
- sales/trials closed для ИжГМУ;
- historical data не используются как current offer.

## Production deployment boundary

PR #225 merged в `main` commit `8f5826f30ecbbe31e625cb0def8b03c87a61f133`.

Cloud.ru deploy run `32047650200` успешно развернул exact immutable image:

`kgmu-calendar-api.cr.cloud.ru/api@sha256:b5ba9a858d201e31e62cd229f03d19852e1a82974c0f6a294724ca7330b86cd2`.

Deployment изменил только image; protected production template fingerprint остался `ae0c556d35845739182c31c7068f88c0e75fb3ef4f9746190e363d835cd227a8`. После deploy контейнер `running`, production smoke PASS, `/health` корректен, `/api/v2/meta` подтверждает `sales=closed`, `trials=closed`, `paymentMode=test`, а unauthenticated `/api/v1/schedule-review/control` остаётся защищённым (`401`).

Это означает, что source-set review и explicit publication boundary доступны в production backend, но само расписание ИжГМУ 2026/2027 ещё не опубликовано и коммерческие gates не открыты.

## Текущий результат

На 2026-08-17 live acquisition успешно скачивает 48/48 источников текущей официальной страницы, но page context остаётся `2025/2026 + spring`. Exact target sources `2026/2027 + autumn` для active scope = 0, поэтому состояние корректно `waiting`; review issue и publication не запускаются.
