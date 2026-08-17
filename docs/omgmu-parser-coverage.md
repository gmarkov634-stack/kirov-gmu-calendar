# ОмГМУ — parser coverage и readiness

Дата актуализации: 17.08.2026.

Статус: **известные structural profiles ОмГМУ подключены к canonical boundary и общему ядру; осенний current-period coverage 2026/2027 ожидает официальные источники**.

Этот документ является текущей агрегирующей картой покрытия ОмГМУ. Ранние поэтапные документы (`omgmu-parser-audit.md`, отдельные O-rule/canonical step docs) сохраняются как история решений, но их старые разделы «не покрыто» не должны использоваться как текущий статус, если более поздняя реализация уже закрыла соответствующий gap.

## 1. Что означает coverage

Для ОмГМУ разделяются три разных уровня готовности:

1. **Profile capability** — код умеет fail-closed распознать и разобрать подтверждённую structural family PDF, сохраняя source evidence и O-rule IDs.
2. **Historical validation** — конкретный зафиксированный PDF/SHA из весны 2025/2026 прошёл regression и canonical/common-core проверки.
3. **Current-period coverage** — фактический официальный источник `2026/2027 + autumn` проверен на совместимость с известным profile либо получил новый source-bound review. До появления такого источника historical validation не считается доказательством текущего товарного расписания.

Profile capability не означает полноту календаря группы. Если расписание группы складывается из нескольких source parts, публикация разрешается только после получения всех обязательных частей и сборки полного group batch.

## 2. Подтверждённые structural profiles

| Profile | Historical source evidence | Canonical path | Historical regression | Текущий статус |
|---|---|---|---|---|
| `weekly_grid` | `1.1.pdf`, `1.2.pdf`, `2.1.pdf`, `2.2.pdf`, `3.pdf`; geometry-backed group ownership | `weekly geometry → exact approved review → O65 materialization → canonical batch` | full-group anchors 2101 и 385; geometry/review/weekday mismatch tests | **PROFILE READY; current 2026/27 WAITING** |
| `course_lecture_list` | `4lek.pdf`, exact Russian source fixture, SHA-bound | evidence-rich lecture parser → `course-lecture-list.mjs` → canonical batch | 20 source-series / 69 events; O66–O68 fail-closed; common QA + ICS PASS | **PROFILE READY; current 2026/27 WAITING** |
| `cycle_rotation_grid` | `4zan.pdf`, Russian geometry, groups 485/486 | geometry/source records → cycle materialization → canonical batch | group 485: 10 source-series / 106 events; common QA + ICS PASS | **PROFILE READY; current 2026/27 WAITING** |
| `combined_rotation_table` | `5.pdf`, pages 3–4, group 585 | geometry + O69 page continuation + O70/O29 control materialization → canonical batch | 16 source-series → 17 user-series → 154 events; common QA + ICS PASS | **PROFILE READY; current 2026/27 WAITING** |

Authoritative registry: `api/src/adapters/omgmu/source-profiles.mjs`.

Неизвестный или неоднозначный structural profile всегда даёт `needs_review`; routing по имени файла, номеру курса или визуальному сходству запрещён.

## 3. Historical regression baseline

Immutable offline gate: `.github/workflows/omgmu-historical-regression.yml`.

Manifest: `api/test/fixtures/omgmu-historical-regression.v1.json`.

Закреплённые anchors:

- `course_lecture_list`: `4lek.pdf`, 20 source-series, 69 events;
- `weekly_grid`: full-group anchors 2101 и 385;
- `cycle_rotation_grid`: group 485, 10 source-series, 106 events;
- `combined_rotation_table`: group 585, 16 source-series, 154 events.

Historical gate также проверяет source-version fail-closed, watcher/review-only boundary, source-bound canonical review, retired direct-S3 publication, common canonical pipeline, ICS, versioning и multi-university isolation.

Historical fixtures не обращаются к live-сайту ОмГМУ и не используются как текущий commercial offer.

## 4. Review и publication boundary

Production-target chain:

`official source → source snapshot/SHA → source profile → semantic ChatGPT review → canonical-reviewed/v1 → common QA → explicit publication → current → subscription feed`.

Закреплённые инварианты:

- reviewed package должен быть связан с exact PDF filename + SHA-256;
- хотя бы одно событие каждого batch должно иметь provenance к reviewed PDF;
- `needs_review` или canonical QA failure не публикуются;
- submit review переводит candidate только в `READY_TO_PUBLISH`;
- current меняется только отдельной explicit publication командой;
- временный 404/5xx, исчезновение ссылки, download/parser failure не удаляют last-known-good current;
- legacy direct-S3 publication retired и не является production path.

Отдельный файловый mirror `reviewed/omgmu/...` **не является обязательным source of truth**: reviewed normalized package уже хранится source-bound через review queue/object storage. Добавлять второй параллельный publication authority запрещено без отдельной причины.

## 5. Common platform integration

ОмГМУ использует общее ядро проекта, а не отдельный backend:

- `schedule-event/v1` / `schedule-batch/v1`;
- input/output validation;
- versioning/diff;
- postprocessing;
- floating-time ICS;
- `YearAwareStore` / current pointer;
- tokenized subscription feed;
- live catalog;
- shared YooKassa/order/subscription contour.

Отдельный legacy publisher ОмГМУ не допускается.

## 6. Production capability, уже доказанная на historical approved data

Непубличный production E2E выполнен на группе 2101 (`medicine-international`, course 2, stream 1):

- полный canonical batch: 176 событий;
- canonical publication → current → персональный subscription URL;
- controlled A→B update одного `end_time`;
- тот же URL отдал новую версию без повторного импорта;
- UID изменённого события сохранился;
- `SEQUENCE` вырос;
- rollback B→A восстановил исходное время при том же UID;
- preview subscription после проверки отозвана;
- sales во время E2E оставались закрыты.

Этот E2E доказывает production-механику publication/update/subscription для tenant `omgmu`, но **не является продажей актуального расписания 2026/27 и не заменяет current-period review**.

## 7. Source watch 2026/2027

`.github/workflows/omgmu-source-watch.yml` работает как independent observation layer.

Target gate жёсткий:

- `academicYear = 2026/2027`;
- `semester = autumn`;
- источник относится к целевой программе/курсу текущего offer scope.

При exact match workflow скачивает PDF, считает SHA-256, сохраняет artifact и создаёт дедуплицированную issue `OMGMU-SOURCE-<sha-prefix>` для semantic review. Он не выполняет смысловой разбор нового PDF, не публикует расписание и не открывает sales/trial gates.

Последний зафиксированный live-state на 17.08.2026:

- manifest валиден;
- найдено 16 распознанных source links;
- 8 относятся к historical `medicine-international`;
- 8 относятся к внецелевым магистерским разделам;
- current target ordinary-program sources `2026/2027 + autumn`: 0;
- `status=waiting`;
- `readyFor2026AutumnIngest=false`.

## 8. Catalog и commercial boundary

Landing ОмГМУ использует server-owned live state:

- `/api/v2/meta` — sales/payment mode/offers;
- `/api/v2/catalog/omgmu/...` — только реально опубликованные группы текущего offer period;
- exact `groupId/groupCode/stream` проходят storage → catalog → frontend → checkout без реконструкции на клиенте;
- статический список sellable groups и локальная authoritative price отсутствуют.

До current-period publication группа не должна появляться в sellable catalog.

## 9. Что НЕ считается закрытым до 2026/27

До появления осенних источников нельзя утверждать:

- что новые PDF имеют те же четыре profile без проверки;
- что historical group ranges совпадают с 2026/27;
- что все программы ОмГМУ покрыты текущими parsers;
- что historical medicine-international schedule является current offer;
- что OmGMU paid checkout E2E на актуальной группе уже выполнен.

Любой новый structural family требует отдельного source-bound profile/rules/regression, а не расширения существующего parser по аналогии.

## 10. Реальные оставшиеся structural задачи до появления расписания

1. Поддерживать этот coverage-документ как authoritative агрегат вместо чтения десятков step-docs.
2. Зафиксировать отдельный `docs/omgmu-launch-gate.md` с условиями открытия current-period публикации и продаж.
3. Добавить агрегирующий launch-readiness smoke/report, который не требует реального 2026/27, но проверяет неизменность historical gate, source-watch fail-closed, live catalog fail-closed и tenant isolation.
4. До появления current source не расширять parser coverage искусственно и не материализовывать historical schedule в current offer.

После появления первого `2026/2027 + autumn` source дальнейшая работа начинается с exact PDF/SHA и semantic review, а не с переработки общего backend.