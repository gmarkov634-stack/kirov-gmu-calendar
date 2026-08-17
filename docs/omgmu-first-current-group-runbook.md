# ОмГМУ — первая актуальная группа 2026/2027: controlled launch runbook

Дата: 17.08.2026.

Статус: **WAITING FOR OFFICIAL 2026/2027 AUTUMN SOURCE**.

Назначение этого документа — дать короткую последовательность действий для первой реально опубликованной группы ОмГМУ. Он дополняет `omgmu-launch-gate.md` и `omgmu-runbook.md`, но не заменяет их.

Главный инвариант: **ни один шаг этого runbook сам по себе не открывает массовые продажи или trial**. `COMMERCIAL_SALES_ENABLED` и `TRIALS_ENABLED` остаются закрыты до отдельного финального решения после всех smoke/E2E.

## 0. Preconditions

До начала:

- structural readiness ОмГМУ = PASS;
- historical regression = PASS;
- source-watch healthy;
- sales = closed;
- trials = closed;
- текущий offer period = `2026/2027 + autumn`;
- исторические PDF 2025/2026 не используются как current offer.

## 1. Exact current source

1. Source-watch обнаруживает target PDF только при exact `academicYear=2026/2027` и `semester=autumn`.
2. Сохранить exact official URL, filename, program/course/stream/source role.
3. Скачать immutable PDF.
4. Рассчитать SHA-256.
5. Создать/связать source-bound review candidate.
6. Убедиться, что candidate не является historical fixture и не переиспользует старый SHA.

**Stop condition:** неоднозначный year/semester/program, ошибка загрузки или отсутствие точного SHA → остановка без изменения `current`.

## 2. Semantic review

1. ChatGPT разбирает exact PDF/SHA.
2. Определить structural profile.
3. Если profile неизвестен или отличается от historical baseline — создать отдельные source-bound rules/regression; не использовать fallback по сходству.
4. Проверить все обязательные source parts группы.
5. Собрать полный group batch; lecture-only/cycle-only partial publication запрещена.
6. Все unresolved случаи остаются `needs_review`.

**Stop condition:** хотя бы один обязательный source part отсутствует или имеет unresolved semantic blocker → публикация запрещена.

## 3. Canonical preflight

Для полного group batch:

1. `schedule-batch/v1` schema validation.
2. input QA = PASS.
3. versioning/diff.
4. postprocessing.
5. output QA = PASS.
6. ICS preflight = PASS.
7. Проверить provenance к exact reviewed PDF/SHA.
8. Проверить floating time — время должно совпадать с официальным расписанием без timezone shift.

## 4. Explicit publication

1. Выполнить только explicit canonical publication.
2. Убедиться, что запись immutable version завершена до переключения `current`.
3. Read-back опубликованной версии из storage.
4. Проверить exact university/program/course/groupCode/groupId/stream/year/semester.
5. Проверить, что last-known-good сохраняется при simulated source disappearance/parser failure.

Legacy direct-S3 path запрещён.

## 5. Live catalog smoke

1. `/api/v2/catalog/omgmu/programs` показывает программу только после фактической current-period publication.
2. Groups endpoint показывает точную опубликованную группу.
3. `groupId`, `groupCode`, `course`, optional `stream` совпадают с storage context.
4. Неопубликованные группы не появились.
5. Historical 2025/2026 группы не появились в current offer.
6. Landing при этом всё ещё не должен позволять оплату, если global sales gate закрыт.

## 6. Current-period subscription smoke

Создать непубличный preview/test subscription token:

1. Открыть тот же subscription URL и проверить expected VEVENT count.
2. Проверить несколько source-bound событий вручную: дата, start/end, discipline, location.
3. Проверить стабильные UID.
4. Выполнить одно контролируемое изменение одного события через canonical publication B.
5. Тот же URL должен отдать B без повторного импорта.
6. UID изменённого события сохраняется; `SEQUENCE` растёт.
7. Выполнить rollback B→A.
8. Повторный A должен быть идемпотентным.
9. Отозвать preview token; revoked feed = 0 VEVENT.

## 7. Controlled payment/fulfillment E2E

Массовые продажи всё ещё закрыты.

1. Проверить `/api/v2/meta`: ожидаемый payment mode и backend-owned price/plan.
2. Использовать exact group context из live catalog.
3. Создать один controlled OmGMU test checkout.
4. Подтвердить `payment.succeeded`/reconcile.
5. Order должен стать `succeeded`.
6. Fulfillment должен создать paid subscription с `university=omgmu` и exact group identity.
7. Backend-issued paid subscription URL должен отдавать полный ICS.
8. Выполнить контролируемое последующее schedule update и проверить тот же paid URL, stable UID и рост `SEQUENCE`.
9. Отозвать test paid subscription после проверки, если она не сохраняется по отдельной утверждённой test policy.

## 8. Mobile/landing smoke на фактической группе

На реальном current catalog:

- iPhone/Safari: выбор program/course/group, отсутствие horizontal overflow, отсутствие auto-zoom формы, безопасная зона, открытие checkout только при разрешённом gate;
- Android/Chrome: тот же selection/checkout flow;
- payment return path восстанавливает exact order/group context;
- subscription URL отображается только из backend response;
- при закрытом sales gate кнопка покупки остаётся закрыта даже при существующей группе.

Статический regression mobile contract не заменяет этот device/current-data smoke.

## 9. Launch authorization

Только после PASS шагов 1–8 допускается отдельное решение о запуске.

Перед `COMMERCIAL_SALES_ENABLED=true` повторно подтвердить:

- source current-period и source-bound;
- full group QA PASS;
- current/live catalog PASS;
- current-period subscription smoke PASS;
- controlled payment/fulfillment PASS;
- watcher/recovery healthy;
- tenant isolation PASS;
- landing/mobile не вводит пользователя в заблуждение;
- launch-коммуникация VK соответствует фактической доступности.

Открытие sales gate — отдельная операция и не выполняется этим runbook автоматически.

## 10. После первой группы

После успешного controlled launch первой группы остальные группы подключаются по той же цепочке `source → semantic review → full canonical batch → QA → explicit publication`. Наличие одной успешной группы не означает автоматическую publishability других курсов, потоков или новых structural profiles.
