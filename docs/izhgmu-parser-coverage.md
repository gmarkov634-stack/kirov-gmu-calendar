# ИжГМУ — parser coverage

Статус: **STRUCTURALLY READY / CURRENT DATA WAITING / PRODUCTION CLOSED**

Дата фиксации: 2026-08-17.

Этот документ является агрегированным источником текущего parser/content coverage Ижевского ГМУ. Он не заменяет отдельный реестр правил парсинга и не является разрешением на публикацию исторического расписания.

## Активный scope

Текущий launch-readiness scope ограничен программой `medicine`, курсами 1–3.

| Курс | Группы | Source profiles | Historical status | 2026/27 validation |
|---|---|---|---|---|
| 1 | 101–130 | IZH-WEEKLY + IZH-LECTURE | 30/30 content-ready | WAITING_FOR_SOURCE |
| 2 | 201–230 | IZH-WEEKLY + IZH-LECTURE | 30/30 content-ready | WAITING_FOR_SOURCE |
| 3 | 301–326 | IZH-LEGACY-XLS + IZH-LECTURE | 26/26 publication-candidate content-ready | WAITING_FOR_SOURCE |

Итого active historical baseline: **86/86 групп**, **23 000 base events**, **6 240 potential elective-option events**, финальных semantic overlaps после утверждённой publication policy — **0**.

## Курс 1

- группы 101–130;
- базовый календарь: 11 212 событий суммарно;
- один логический elective block на поток;
- 8 source-bound alternatives;
- выбранная альтернатива добавляет 26 событий: 7 лекций + 19 практик;
- `unselected` является валидным персональным состоянием и не добавляет elective events;
- `IZH-W11` применяется только к exact discipline `Кураторский час`: start-only 16:30 материализуется как 16:30–17:30 с явным project-policy provenance;
- любая другая start-only дисциплина остаётся fail-closed.

Контрольная группа 109: base/unselected 375; выбор `Культурология` → 401; очистка выбора → 375.

## Курс 2

- группы 201–230;
- 201–210: 241 событие/группа;
- 211–220: 225 событий/группа;
- 221–230: 242 события/группа;
- суммарно 7 080 событий;
- source normalization ограничена auditable rules `IZH-M2-01..04`;
- historical shared input/output QA и ICS preflight подтверждены.

## Курс 3

- группы 301–326;
- class source использует отдельный legacy XLS boundary;
- raw diagnostic plane сохраняет противоречие по дисциплине `Стоматология`: практический интервал пересекается с лекционным source, а authoritative правила сокращения/разрыва практики нет;
- publication plane использует только явную typed exclusion `IZH-C3-18` для exact discipline/blocker contract;
- exclusion cardinality зафиксирована: 8 practice events + 7 lecture events + 7 blockers; изменение contract возвращает сборку в fail-closed review;
- отдельная source-specific correction Патофизиологии разрешена только при exact source invariants;
- publication candidate: 26/26 групп, 4 708 событий, historical QA/ICS PASS.

## Deferred / out-of-scope

- medicine 4–6: **DEFERRED**. Существующие parser/diagnostic code и evidence сохраняются, но не участвуют в active readiness или launch gate;
- pediatrics: вне initial commercial scope;
- dentistry: вне initial commercial scope.

Наличие кода для deferred scope не означает его production readiness.

## Source acquisition boundary

Проверенный historical source snapshot: spring 2025/2026.

- обнаружено/скачано: 48/48;
- failures: 0;
- containers: 47 XLSX + 1 legacy XLS;
- fingerprints: 12 IZH-WEEKLY / 10 IZH-CYCLE / 25 IZH-LECTURE / 1 IZH-LEGACY-XLS;
- source identity каждого файла: official schedule entrypoint + exact URL + SHA-256;
- source-set identity текущего оффера: SHA-256 от отсортированных `URL + NUL + file SHA-256` всех exact target members;
- Cloud.ru не является authoritative downloader ИжГМУ; acquisition выполняется GitHub Actions из-за подтверждённой сетевой недоступности igma.ru из production runtime.

Unknown structure, invalid container, metadata conflict, SHA drift или изменившийся source invariant не маршрутизируются на ближайший parser автоматически и остаются fail-closed.

## Current-period source watch

Workflow `.github/workflows/izhgmu-source-watch.yml` выполняет hourly observation для exact target `medicine + courses 1–3 + 2026/2027 + autumn`.

Он может вернуть:

- `waiting` — exact target отсутствует;
- `review-required` — target наблюдается, но полный validated/downloaded source set не получен;
- `candidate` — полный exact source set загружен и имеет deterministic digest.

При `candidate` сохраняется immutable observation artifact и создаётся дедуплицированная source-bound GitHub issue. Watcher не выполняет semantic parsing, не вызывает schedule publication и не меняет catalog/trials/sales.

Контрольный live run 2026-08-17: official discovery 48 sources, validation `ok`, download 48/48, failures 0; page context `2025-2026 + spring`; exact target `2026/2027 + autumn` sources = 0; status `waiting`. Поэтому review issue не создавалась.

## Current-period reviewed publication boundary

Protected shared `/api/v1/schedule-review/control` поддерживает IzhGMU `review.create`, после которого создаётся только `REVIEW_REQUIRED` для exact source-set digest текущего периода.

Semantic review выполняет ChatGPT. Package `canonical-reviewed/v1` обязан содержать `source_set_digest`. Каждый batch и event проверяются против exact reviewed members: `schedule.source_files`, `source.file_name` и `source.file_hash` должны принадлежать reviewed source set и совпадать по SHA.

Source-set digest не добавляется в shared `schedule-batch/v1`, поэтому общий canonical schema КГМУ/ОмГМУ не меняется.

`review.submit` выполняет canonical QA и даёт только `READY_TO_PUBLISH`. Изменение `current` возможно только отдельной explicit `review.publish` / `review.submit_publish`, которая использует общий `prepareSchedulePublication()` и `YearAwareStore`.

Current publication boundary отдельно отклоняет:

- historical `2025/2026`;
- semester кроме autumn;
- program кроме medicine;
- medicine courses 4–6.

Исчезновение/ошибка source не проходит через publication plane и поэтому не может очистить last-known-good `current`.

## Current-period rule

Historical spring 2025/2026 используется только для regression/readiness доказательства архитектуры. Он **не является** товарным offer 2026/2027.

До текущей публикации каждый курс должен пройти повторно на exact official source:

`2026/2027 + autumn → download → SHA-256 → source-set digest → structural fingerprint → ChatGPT semantic review → full group batch → canonical QA → explicit publication`.

Coverage 2026/27 считается подтверждённым только после прохождения этого пути для конкретного официального source set.

## Regression authority

Immutable/offline baseline запускается через:

`npm run regression:izhgmu:historical`

Workflow: `.github/workflows/izhgmu-historical-regression.yml`.

Gate включает current-source watcher safety, source-set-bound canonical review и main wiring к единственному shared protected publication control. Он намеренно не обращается к текущему сайту ИжГМУ. Live source acquisition/watch является отдельным контуром и не может переписать historical expectations.

## Production state

До отдельного launch authorization должны сохраняться:

- `izhgmu.active = false`;
- public catalog closed;
- university commercial gate closed;
- trials/sales не открываются этим coverage;
- historical data не публикуются как current offer;
- deferred medicine 4–6 не блокируют и не расширяют active readiness scope.

Подробные gates: `docs/izhgmu-launch-gate.md`. Операционный путь первого текущего source: `docs/izhgmu-current-source-runbook.md`.
