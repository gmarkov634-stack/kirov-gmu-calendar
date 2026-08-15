# ОмГМУ — `weekly_grid`: approved source-bound review в canonical path

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОЙ ВЕТКЕ**.

Правила O01–O72 не менялись. Реализован отдельный слой применения уже ранее подтверждённых manual-review решений к новому geometry/canonical пути.

## Исходное состояние

Raw source-layer audit пяти `weekly_grid` PDF:

- 40 групп;
- 272 independent source-series;
- 10 `needs_review` series;
- 0 unresolved diagnostics;
- 22/40 групп publishable без ручных решений.

В существующем `universities/omgmu/manual-review.json` уже были approved source-bound решения пользователя от 10.08.2026 для:

`2113, 2114, 389, 393`.

Они привязаны к точным official source file + SHA-256 и не являются новыми parsing rules.

## Машиночитаемое представление уже утверждённых решений

В registry добавлен `canonicalResolution`, не меняющий смысл исходного user-approved решения.

### 2113 / 2114

Source:

`04_medicine-international_course-2_stream-2_combined.pdf`

SHA-256:

`35983ba32a518f9d61c184ba946907ec9d56b2bd03a99d2ace8bb1b3ad8afc69`

Серия:

`Биохимия, 16:20–18:45, 13 з.: 09.04–02.07`.

Structural PDF row конфликтует с напечатанным диапазоном. Ранее approved decision: сохранить прямо напечатанные четверги 09.04–02.07.

Canonical resolution содержит точные 13 дат:

`09.04, 16.04, 23.04, 30.04, 07.05, 14.05, 21.05, 28.05, 04.06, 11.06, 18.06, 25.06, 02.07`.

### 389 / 393

Source:

`05_medicine-international_course-3_combined.pdf`

SHA-256:

`5a77c3eaede8e32887bc8c768cb19b5aaa6d9506249b2484ffb0bbb2f3bc9427`

Серия:

`14:20–16:00 Спортивные игры/Плавание/Атлетическая гимнастика, 1 з.: 24.06`.

Она визуально находится в Thursday row, но 24.06.2026 — среда. Ранее approved decision: сохранить явно напечатанную дату `24.06.2026`.

## Реализация

Добавлен:

`api/src/adapters/omgmu/weekly-reviewed.mjs`

`applyApprovedWeeklyReview()` работает fail-closed:

- ищет approved entry только для exact group/course/stream;
- требует `canonicalResolution`;
- требует exact `sourceFile`;
- требует exact `sourceSha256`;
- resolution должна совпасть ровно с одной source-series по discipline + time + dateExpression;
- zero или multiple matches блокируют review application;
- изменение PDF SHA немедленно инвалидирует старое решение.

После применения серия получает `parse.status=warning`, audit warning с approved decision и marker вида `manual-review:2026-08-10:<group>`. Raw source/PDF geometry references остаются неизменными.

`weekly-grid.mjs` теперь выполняет порядок:

`geometry parse → exact source-bound approved review → O65 materialization → canonical batch`.

То есть manual review не заменяет parser и не подменяет O65.

## Проверка через common core

Добавлен regression:

`api/test/omgmu-weekly-reviewed-canonical.test.js`.

Проверено:

- 2113: 13 approved Thursday dates, status warning, canonical batch 13 events, common input/output QA PASS, floating ICS;
- 389: exact `24.06.2026` сохраняется, canonical QA PASS;
- любой SHA drift вызывает `OMG_WEEKLY_REVIEW_SOURCE_CHANGED` до публикации.

## Полный reviewed audit на текущих пяти PDF

Workflow `omgmu-weekly-geometry-report.mjs` теперь считает одновременно raw и reviewed publishability и сам SHA-256 хэширует текущий PDF перед review application.

Итог workflow run #282:

- files: 5;
- groups: 40;
- source-series: 272;
- raw `needs_review`: 10;
- diagnostics: 0;
- O65 merges: 2;
- raw publishable: **22/40**;
- approved reviews applied: **4**;
- publishable after approved review: **26/40**.

После review становятся чистыми дополнительно:

`2113, 2114, 389, 393`.

### Текущий reviewed-publishable набор

`2101–2110`,
`2111–2114`,
`2117–2120`,
`385, 386, 387, 388, 389, 393, 394, 395`.

Итого: **26 групп**.

### Остаются blocked: 14 групп

Весь 1 курс:

`1101–1112`.

Причины — реальные O06/O57 source inconsistencies, подробно зафиксированные в `docs/omgmu-weekly-grid-source-audit.md`.

И дополнительно:

`2115, 2116` — source literally содержит `Топ. анатомия и ОХ/**, 710 зан.: 09.04–30.07`; автоматическая коррекция в `7/10` не выполняется без отдельного утверждённого решения.

## Коммиты

- `92c734d67088b45ce74f0e08cd61871f82b0d0fc` — machine-readable encoding approved decisions;
- `f29870988be33dfe2d3e083d86915bbd126adcbc` — source-bound review layer;
- `a85d64480e1b0840dd5e839dda4c086a0e80789f` — review integration before O65/canonical;
- `f2a80bccdc5a86eaf2e261b0aef2976a5637abad` — canonical/review/SHA regressions;
- `354e52207dbb2aebaaa209847fbb449415da6328` — reviewed publishability in workflow report.

Проверка implementation head `354e52207dbb2aebaaa209847fbb449415da6328`:

- API tests #867 — **SUCCESS**;
- ОмГМУ source discovery #282 — **SUCCESS**;
- `Analyze weekly_grid geometry` — **SUCCESS**;
- artifact report: `publishableGroupsAfterApprovedReview = 26`.

## Следующий шаг

Не ослаблять QA ради оставшихся 14 групп. Следующий технический этап — построить полноценный canonical batch + common pipeline regression для нескольких из 26 уже чистых групп, включая одну группу 2 курса и одну 3 курса, на полном geometry PDF, а не на subset. Это подтвердит полный `weekly_grid → canonical → common core` для publishable группы.

Параллельно оставшиеся source inconsistencies первого курса и 2115–2116 остаются в review backlog и могут быть разрешены только отдельным русскоязычным official evidence либо явным manual decision; английская часть не используется для коррекции по O64.
