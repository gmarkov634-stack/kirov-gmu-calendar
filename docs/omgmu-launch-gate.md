# ОмГМУ — launch gate

Дата актуализации: 17.08.2026.

Текущий статус: **STRUCTURALLY READY / CURRENT DATA WAITING / SALES CLOSED**.

Этот gate определяет момент, когда ОмГМУ можно считать готовым к фактическому запуску на расписании 2026/2027. Он не заменяет parser QA и не открывает продажи автоматически.

## 1. Принцип

Публикация расписания, его появление в live catalog и открытие продаж — разные действия.

Даже успешно опубликованная current-period группа не должна сама включать коммерческий checkout. Любой отсутствующий, неоднозначный или не подтверждённый prerequisite трактуется как `closed`.

Исторические PDF весны 2025/2026 используются только для regression и доказательства механики платформы. Они не могут быть текущим offer 2026/2027.

## 2. Gate A — current-period source

Обязательные условия:

- [ ] официальный source page ОмГМУ однозначно относится к `2026/2027`;
- [ ] semester/term однозначно `autumn`;
- [ ] найден хотя бы один source для целевой продаваемой программы;
- [ ] source скачан как exact immutable PDF;
- [ ] рассчитан SHA-256;
- [ ] сохранены official URL, filename, program/course/stream/source role;
- [ ] source-watch создал или связал source-bound review candidate;
- [ ] новый SHA не подменён historical fixture.

Если year/semester/program не определены однозначно, launch остаётся закрытым.

## 3. Gate B — semantic parser coverage

Для каждой публикуемой группы:

- [ ] каждый необходимый source part классифицирован одним подтверждённым profile;
- [ ] либо новый structural profile отдельно разобран и зафиксирован правилами/regression;
- [ ] semantic review выполнен по exact PDF/SHA;
- [ ] нет silent fallback на другой profile;
- [ ] нет unresolved `needs_review`;
- [ ] все source-specific warnings либо неблокирующие по подтверждённому правилу, либо явно разрешены source-bound review;
- [ ] собран **полный** group batch, а не lecture-only/cycle-only partial publication;
- [ ] provenance каждого значимого event ведёт к фактическому source evidence.

Profile capability из historical 2025/26 не считается автоматическим подтверждением совместимости нового PDF.

## 4. Gate C — canonical QA и publication

Для первой current-period группы и далее для каждой публикуемой группы:

- [ ] `schedule-batch/v1` валиден;
- [ ] input QA = PASS;
- [ ] versioning/diff успешно назначены;
- [ ] postprocessing завершён;
- [ ] output QA = PASS;
- [ ] ICS preflight = PASS;
- [ ] exact reviewed PDF/SHA проходит source binding;
- [ ] explicit publication выполнена через общий canonical publication boundary;
- [ ] current pointer переключён только после успешной записи;
- [ ] опубликованная версия читается обратно из storage;
- [ ] last-known-good остаётся неизменным при simulated source disappearance/parser failure.

Legacy direct-S3 path не допускается.

## 5. Gate D — live catalog и идентичность группы

После publication:

- [ ] программа появилась в `/api/v2/catalog/omgmu/programs` только потому, что существует current-period schedule;
- [ ] нужная группа появилась в server-owned groups catalog;
- [ ] `groupId`, `groupCode`, `course` и optional `stream` совпадают с опубликованным schedule context;
- [ ] frontend не реконструирует stream/group identity самостоятельно;
- [ ] неопубликованные группы отсутствуют в sellable catalog;
- [ ] исторические 2025/26 группы не попали в offer 2026/27.

## 6. Gate E — subscription delivery

Общая механика уже доказана historical production E2E на группе 2101; перед launch current period требуется короткий smoke на актуальной группе:

- [ ] создан непубличный test/preview subscription token для current-period group;
- [ ] тот же персональный URL отдаёт expected VEVENT count;
- [ ] UID стабильны;
- [ ] floating times совпадают с источником;
- [ ] controlled republish/update на current-period candidate отражается на том же URL;
- [ ] `SEQUENCE` изменённого события растёт;
- [ ] rollback/идемпотентный republish не ломает identity;
- [ ] test token после проверки отозван.

Этот smoke не должен открывать массовые продажи.

## 7. Gate F — payment/fulfillment

Перед реальными продажами ОмГМУ:

- [ ] `/api/v2/meta` показывает ожидаемый payment mode;
- [ ] return URL ОмГМУ соответствует текущему landing;
- [ ] price/plan берутся только из server-owned offer config;
- [ ] checkout использует exact live catalog group context;
- [ ] выполнен один controlled OmGMU test payment на current-period QA-approved группе;
- [ ] `payment.succeeded`/reconcile создаёт order со статусом succeeded;
- [ ] fulfillment создаёт paid subscription именно для `university=omgmu`;
- [ ] backend-issued paid subscription URL отдаёт полный ICS;
- [ ] paid URL получает последующее schedule update без повторного импорта;
- [ ] test paid subscription после проверки безопасно отозвана либо явно сохранена как test fixture по утверждённой политике.

Historical preview-subscription E2E не заменяет OmGMU payment E2E.

Если используется настоящий магазин/реальные деньги, отдельно обязателен минимальный live payment smoke и проверка чеков/режима YooKassa перед массовым открытием.

## 8. Gate G — trials

Trial не является обязательным условием самой продажи, но если лендинг обещает бесплатную пробу, до её включения обязательно:

- [ ] `TRIALS_ENABLED` открывается только после current-period publication;
- [ ] trial создаётся для exact live group;
- [ ] trial feed содержит только утверждённое окно;
- [ ] continue context не раскрывает subscription token;
- [ ] trial → paid создаёт отдельный paid token;
- [ ] linked trial корректно retired/upgraded;
- [ ] trial gate после smoke возвращён в согласованное состояние.

Если trial не используется в launch campaign, gate остаётся закрытым и не блокирует paid launch.

## 9. Gate H — watcher и recovery

Перед launch:

- [ ] hourly source-watch workflow зелёный;
- [ ] exact target `2026/2027 + autumn` распознаётся без ослабления period gate;
- [ ] unchanged URL+SHA не создаёт duplicate review;
- [ ] same URL/new SHA создаёт новый candidate;
- [ ] new URL создаёт новый candidate;
- [ ] 404/5xx/network failure diagnostic-only;
- [ ] исчезновение source link не меняет current;
- [ ] unknown structural source создаёт review issue и не публикуется;
- [ ] historical regression workflow зелёный.

## 10. Gate I — tenant isolation

- [ ] OmGMU source/review/publication context всегда имеет `university=omgmu`;
- [ ] KGMU и IzhGMU schedules не могут попасть в OmGMU catalog/subscription;
- [ ] stream/groupId не теряются между canonical batch, storage, catalog и checkout;
- [ ] OmGMU VK tenant credentials не fallback-ятся на KGMU credentials;
- [ ] общие изменения проходят multi-university regression.

## 11. Gate J — landing и коммуникации

Технический launch landing:

- [ ] current groups берутся только из live catalog;
- [ ] при пустом catalog UI работает fail-closed;
- [ ] цена не является authoritative frontend-константой;
- [ ] mobile/iPhone/Safari smoke PASS;
- [ ] payment return path PASS;
- [ ] wording не заявляет доступность групп, которых нет в current catalog.

VK не является техническим prerequisite для выдачи календаря, но launch-коммуникация считается готовой, если:

- [x] отдельное сообщество `calendaromsu` существует;
- [x] название/описание/website актуализированы;
- [x] статус сообщает подготовку 2026/2027;
- [x] avatar и cover установлены и проверены;
- [x] вводный информационный пост опубликован;
- [x] ссылка «Получить календарь» ведёт на landing;
- [ ] launch-пост публикуется только после фактического current-period QA+publication.

## 12. Условия открытия продаж

`COMMERCIAL_SALES_ENABLED=true` допустимо устанавливать только когда одновременно выполнены:

1. Gate A — есть current `2026/2027 + autumn` source.
2. Gate B — полная semantic completeness продаваемой группы.
3. Gate C — canonical QA + explicit publication PASS.
4. Gate D — группа присутствует в live catalog с exact identity.
5. Gate E — current-period subscription smoke PASS.
6. Gate F — controlled OmGMU payment/fulfillment E2E PASS.
7. Gate H — watcher/recovery healthy.
8. Gate I — isolation PASS.
9. Gate J — landing не вводит пользователя в заблуждение.

Trial gate открывается независимо и только если нужен product/marketing flow.

## 13. Текущий статус на 17.08.2026

| Область | Статус |
|---|---|
| Known parser profiles | **PASS / historical** |
| Canonical/common core | **PASS** |
| Source-bound review | **PASS** |
| Direct legacy publication retired | **PASS** |
| Historical regression | **PASS** |
| Production publication/current/subscription mechanics | **PASS on historical group 2101** |
| Live server-owned catalog/checkout wiring | **PASS structurally** |
| Source watcher/review issue boundary | **PASS; waiting for target source** |
| Current 2026/27 autumn source | **BLOCKED / external data** |
| Current-period full group publication | **WAITING** |
| Current-period subscription smoke | **WAITING** |
| OmGMU payment/paid-subscription E2E | **WAITING** |
| Mass sales | **CLOSED** |
| VK launch readiness | **READY except final launch post** |

## 14. Что можно делать до появления 2026/27

Не требуется переписывать parsers или коммерческий backend. До появления source полезны только structural readiness задачи:

1. поддерживать `omgmu-parser-coverage.md` и этот launch gate актуальными;
2. создать автоматический launch-readiness report/smoke, который проверяет уже существующие invariants без current source;
3. закрепить state/reporting так, чтобы появление первого target PDF сразу переводило процесс из `WAITING_SOURCE` в `REVIEW_REQUIRED`, но никогда напрямую в publication;
4. не открывать sales/trial gates и не использовать historical schedule как current offer.

После появления источника работа начинается с Gate A, а не с нового проектирования платформы.