# ОмГМУ — единый текущий статус

Дата актуализации: 17.08.2026.

**Итоговый статус: STRUCTURALLY READY / CURRENT DATA WAITING / SALES CLOSED.**

Этот документ — верхнеуровневая точка входа для ответа на вопрос «что сейчас с ОмГМУ?». Он не заменяет специализированные runbook/gate/coverage-документы, а агрегирует их текущий результат. Если старый пошаговый документ противоречит этому статусу, использовать более поздний специализированный документ и фактический код/CI.

## 1. Сводка

| Контур | Статус | Что доказано | Что ещё ожидается |
|---|---|---|---|
| Parser profiles | 🟢 STRUCTURAL READY | `weekly_grid`, `course_lecture_list`, `cycle_rotation_grid`, `combined_rotation_table`; historical regression + canonical path | source-bound проверка новых PDF 2026/27 |
| Canonical/common core | 🟢 READY | `schedule-batch/v1`, QA, versioning, postprocessing, ICS, explicit publication | current-period batch первой реальной группы |
| Historical regression | 🟢 PASS | immutable fixtures, source/version fail-closed, group anchors, common core | поддерживать зелёным |
| Source watcher | 🟢 READY / WAITING | observation-only, exact period gate, SHA/review issue boundary, last-known-good safety | официальный `2026/2027 + autumn` source |
| Review/publication boundary | 🟢 READY | exact PDF+SHA, `REVIEW_REQUIRED → READY_TO_PUBLISH → explicit publish`; watcher не публикует | semantic review первого current source |
| Storage/current/subscription | 🟢 MECHANICS PROVEN | historical production E2E group 2101, same URL, stable UID, SEQUENCE, rollback | current-period smoke |
| Live catalog | 🟢 STRUCTURAL READY | server-owned group identity; unpublished/historical groups не должны становиться offer | первая current publication |
| Payment/fulfillment | 🟡 WAITING CURRENT DATA | shared YooKassa/order/subscription contour существует | controlled OmGMU current-period payment E2E |
| Landing | 🟢 STRUCTURAL READY | fail-closed catalog/checkout, mobile/iPhone/Safari contract, CI + Pages PASS | device/payment-return smoke на реальной группе |
| VK ОмГМУ | 🟢 OPERATIONAL READY | отдельный tenant/control plane, production `group.info`, production `wall.post`, landing link verification, intro post | только финальный launch-post после launch gate |
| Documentation | 🟢 CONSOLIDATED | этот status + coverage + launch gate + runbooks + landing audit + VK launch pack | обновлять после current source/launch milestones |
| Mass sales | 🔴 CLOSED BY DESIGN | fail-closed gates | открыть отдельно только после обязательных launch gates |

## 2. Parser и source coverage

Подтверждены четыре structural profile:

1. `weekly_grid`;
2. `course_lecture_list`;
3. `cycle_rotation_grid`;
4. `combined_rotation_table`.

Historical данные 2025/2026 используются только как regression/evidence. Они не являются текущим товарным расписанием.

Authoritative подробности: `docs/omgmu-parser-coverage.md`.

## 3. Current source 2026/2027

Целевой period gate:

- `academicYear = 2026/2027`;
- `semester = autumn`;
- только целевая программа/курс текущего offer scope.

Последнее зафиксированное live-состояние 17.08.2026:

- source manifest валиден;
- распознано 16 links;
- 8 — historical `medicine-international`;
- 8 — внецелевые магистерские разделы;
- exact current target ordinary-program sources `2026/2027 + autumn` = **0**;
- watcher state = `waiting` / `WAITING_SOURCE`.

Это нормальное внешнее ожидание, а не структурная ошибка платформы.

## 4. Source → review → publication

Production path:

`official source → exact PDF/SHA → source profile → ChatGPT semantic review → canonical-reviewed/v1 → input QA → versioning/diff → postprocessing → output QA → ICS preflight → explicit publication → current`.

Инварианты:

- watcher только наблюдает и создаёт review candidate;
- unknown/ambiguous profile = `needs_review`, не guess;
- `review.submit` не меняет current;
- current меняется только отдельной explicit publication;
- partial source parts не публикуются как полный календарь группы;
- 404/5xx/disappearance/parser failure не удаляют last-known-good;
- legacy direct-S3 publication retired.

Operational details: `docs/omgmu-runbook.md`.

## 5. Subscription/current mechanics

На historical approved группе 2101 выполнен production E2E:

- canonical publication → current;
- персональный subscription URL;
- controlled A→B update;
- URL не меняется;
- logical event UID стабилен;
- `SEQUENCE` растёт;
- rollback B→A возвращает baseline;
- preview subscription после проверки отозвана;
- продажи в ходе доказательства не открывались.

Regression закреплён в `api/test/omgmu-storage-subscription-e2e.test.js` и historical gate.

Current-period smoke намеренно остаётся WAITING до первого QA-approved расписания 2026/27.

## 6. Catalog и commerce

Landing получает состояние от backend:

- `/api/v2/meta`;
- `/api/v2/catalog/omgmu/...`;
- exact `groupId/groupCode/course/stream` из server-owned catalog.

До current publication:

- историческая группа не используется как fallback;
- пустой catalog закрывает выбор/checkout;
- frontend не является authoritative источником цены или sellable groups;
- массовые продажи закрыты.

После первой current publication требуется controlled payment E2E:

`checkout → YooKassa test payment → payment.succeeded/reconcile → fulfilled paid subscription → backend-issued ICS URL → последующее update по тому же URL`.

Только после PASS этого и остальных обязательных gates разрешается отдельное открытие sales.

Authoritative gate: `docs/omgmu-launch-gate.md`.

## 7. Landing

Структурный prelaunch audit = PASS:

- fail-closed catalog/checkout;
- один `mobile.css` без dynamic duplicate loader;
- iPhone/Safari 16px form controls;
- safe-area;
- horizontal overflow protection;
- narrow/mobile/landscape handling;
- reduced-motion;
- соответствующие regression и Pages/landing CI зелёные.

Не закрыты без current group:

- физический iPhone/Safari smoke;
- Android/Chrome smoke;
- payment return path;
- фактическая выдача current paid subscription;
- финальная wording-проверка после появления доступных групп.

Подробности: `docs/omgmu-prelaunch-landing-audit.md`.

## 8. VK ОмГМУ

Статус: **OPERATIONAL READY / FINAL LAUNCH POST WAITING**.

Сообщество: `https://vk.ru/calendaromsu`.

Что уже доказано не только кодом, но и production operations:

- отдельный endpoint `/api/v1/vk/omgmu/control`;
- отдельный GitHub OIDC workflow `.github/workflows/omgmu-vk-control.yml`;
- tenant credentials ОмГМУ не fallback-ятся на КГМУ;
- production `group.info` успешно выполнен через control plane;
- production `wall.post` успешно выполнен, создан информационный пост `postId=22`;
- название/описание/website/status подготовлены;
- avatar и cover установлены;
- ссылка «Получить календарь» на landing проверена;
- стартовый информационный пост опубликован.

Ограничения, которые не блокируют launch readiness:

- часть branding/menu mutations выполняется вручную из-за доступных VK API capabilities;
- закрепление поста при необходимости выполняется вручную;
- launch copy нельзя публиковать до current-period gate PASS.

Шаблоны и publication checklist: `docs/omgmu-vk-launch-pack.md`.

## 9. Structural readiness и CI

Aggregate command:

`npm run readiness:omgmu`

Workflow:

`.github/workflows/omgmu-launch-readiness.yml`.

Он агрегирует historical regression и structural contracts, включая main merge safety, commerce, watcher/review workflow, VK tenant wiring, watcher status и landing fail-closed/mobile regression.

Нормальный pre-source результат:

`STRUCTURALLY_READY_CURRENT_DATA_WAITING`.

Read-only watcher status:

`GET /api/v2/status/omgmu-watcher`.

## 10. Документы и их роли

- `docs/omgmu-status.md` — **верхнеуровневый текущий статус**;
- `docs/omgmu-parser-coverage.md` — parser/source profile coverage и regression evidence;
- `docs/omgmu-launch-gate.md` — обязательные условия current launch и открытия продаж;
- `docs/omgmu-runbook.md` — operational recovery/review/publication procedures;
- `docs/omgmu-first-current-group-runbook.md` — процедура первой реальной группы 2026/27;
- `docs/omgmu-prelaunch-landing-audit.md` — fail-closed/mobile audit лендинга;
- `docs/omgmu-vk-launch-pack.md` — launch/post-launch VK communication templates и publication checklist.

Ранние пошаговые документы сохраняются как история решений, но не должны использоваться вместо этого status/coverage/gate набора для определения текущей готовности.

## 11. Что реально осталось

До появления официального расписания 2026/2027 новых parser/backend задач, которые оправданно делать без source evidence, нет.

После появления exact current PDF последовательность фиксирована:

1. watcher фиксирует exact PDF + SHA;
2. source-bound semantic review;
3. подтвердить existing profile либо добавить новый profile/rules/regression;
4. собрать **полный** group batch;
5. canonical QA + ICS preflight;
6. explicit publication;
7. проверить live catalog identity;
8. current-period subscription A→B→A smoke;
9. controlled payment/fulfillment E2E;
10. iPhone/Google/Android device smoke;
11. финально проверить landing wording;
12. отдельным решением открыть sales;
13. только после этого опубликовать VK launch-post.

## 12. Итог

Для ОмГМУ пункты «VK operational proof» и «единая документация» считаются закрытыми структурно.

Текущее корректное состояние проекта:

**STRUCTURALLY READY / CURRENT DATA WAITING / SALES CLOSED.**

Главный внешний blocker: отсутствие подтверждённого официального `2026/2027 + autumn` source для current offer.
