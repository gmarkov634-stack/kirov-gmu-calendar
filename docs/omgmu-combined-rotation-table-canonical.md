# ОмГМУ — `combined_rotation_table`: O69/O70 geometry → canonical migration

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОЙ ВЕТКЕ; ГРУППА 585 ПРОХОДИТ ПОЛНЫЙ COMMON-CORE PIPELINE**.

Правила O01–O72 не изменялись.

## Официальный источник

`08_medicine-international_course-5_combined.pdf` (`5.pdf`)

SHA-256:

`6b7862a6aa7fb2a0cca00b9e965eccdeea9ece8825d58da15a6e03b1b38fd328`

Production parsing использует только русские страницы 3–4 по O64.

## Geometry boundary и O69

Добавлен:

`api/tools/omgmu-extract-combined-geometry.py`.

На странице 3 extractor доказательно определяет schema из header + физических границ таблицы:

- discipline: x `12.82–169.20`;
- time: x `200.64–236.04`;
- `К.дн.`: x `236.04–265.08`;
- group 585: x `265.08–414.15`.

Страница 4 не повторяет заголовок. Она принимается как continuation только потому, что фактические semantic column boundaries строк совпадают с уже доказанной schema страницы 3. В geometry фиксируется:

- page 3: `schemaInherited=false`, 10 rows;
- page 4: `schemaInherited=true`, `schemaFromPage=3`, 6 rows.

Если headerless continuation не имеет source schema либо semantic boundaries смещены, extractor/parser работает fail-closed; group 585 не угадывается по позиции текста.

Реальный geometry fixture:

`api/test/fixtures/omgmu-combined-course5.geometry.json.gz.b64`.

## Evidence-rich parser

Добавлен:

`api/src/adapters/omgmu/combined-rotation-table.mjs`.

Parser сохраняет по каждой source row:

- discipline и inheritance левой merged cell;
- time;
- `К.дн.`;
- main date range;
- expanded working dates;
- lecture/cycle marker;
- control date/time;
- page/row/group bbox reference;
- O-rule IDs;
- parse status/warnings;
- признак O69 для inherited page;
- признак O70 для composite range/control/type record.

Calendar year и source exceptions передаются извне; новый parser не содержит собственного hardcoded 2026 calendar.

## Полный source-layer результат

Автоматический report:

`api/tools/omgmu-combined-rotation-report.mjs`.

Workflow run #302 подтвердил:

- group: **585**;
- source rows/series: **16**;
- user-series после control materialization: **17**;
- canonical events: **154**;
- `needs_review`: **0**;
- unresolved diagnostics: **0**;
- O69 inherited source-series: **6**;
- O70 composite source-series: **1**;
- `sourceLayerPublishable=true`.

Все 16 `К.дн.` совпадают с фактически развёрнутыми unique education/control dates.

## O70 + O29: последняя строка

Подтверждённая source row страницы 4:

`Госпитальная терапия, эндокринология | 10:40–13:50 | К.дн. 11 | 24.07–07.08, зачет-07.08 (циклы)`.

Parser сохраняет одну independent source-series:

- main range `24.07–07.08`;
- 11 main dates;
- `declaredDays=11`;
- control `07.08.2026`;
- explicit control time отсутствует;
- O69 + O70 + O29 + O30 + O42;
- status `ok`.

На user layer она материализуется в две series:

1. cycle dates 24.07–06.08;
2. один credit 07.08, 10:40–13:50.

На 07.08 обычный cycle не дублируется. Это сохраняет 11 unique dates и реализует O29 поверх O70 composite record.

Именно поэтому 16 source rows превращаются в 17 user-series, но остаются **154 события**, а не 155.

## Full group 585 → common core

Regression:

`api/test/omgmu-combined-rotation-canonical.test.js`.

Полный real geometry group 585 проходит:

`geometry → 16 source-series → 17 user-series → schedule-batch/v1 → prepareSchedulePublication → input QA → versioning → postprocessing → output QA → ICS`.

Проверено:

- 154 canonical events;
- все `parse.status=ok` до common postprocessing;
- exact source filename/SHA;
- floating timing;
- page-4 records несут O69;
- final composite record несёт O70/O29;
- на 07.08 по госпитальной терапии существуют lecture + credit, но нет cycle duplicate;
- common input QA = PASS;
- output QA = PASS;
- diff first import = 154 added;
- ICS без `TZID=Asia/Omsk` и без `+06:00`.

Regression также намеренно ломает `schemaFromPage` у page 4 и подтверждает fail-closed `OMG_COMBINED_ROTATION_NEEDS_REVIEW`.

Первый вариант regression ошибочно ожидал 16 user-series; CI корректно выявил это. Исправлено: последняя O70 source row закономерно создаёт cycle + credit user-series, поэтому итог = 17. Семантика событий/правил не менялась.

## Source discovery integration

Workflow `ОмГМУ source discovery` теперь выполняет:

- `Extract authoritative combined_rotation_table geometry`;
- `Analyze combined_rotation_table geometry`;
- upload artifact `omgmu-combined-rotation-geometry` с geometry + report.

Final implementation head перед этим документом:

`5210cf01d2ef6c9ea876302c8775f0798a72ba29`.

CI:

- API tests #887 — **SUCCESS**;
- ОмГМУ source discovery #302 — **SUCCESS**;
- combined geometry extraction — SUCCESS;
- combined report — SUCCESS.

Artifact report подтверждает `sourceSeries=16`, `userSeries=17`, `canonicalEventCount=154`, `needsReviewSeries=0`, `diagnostics=[]`, `o69InheritedSeries=6`, `o70CompositeSeries=1`, `sourceLayerPublishable=true`.

## Итог по четырём profile families

Все четыре известных структуры ОмГМУ теперь имеют canonical migration path:

- `course_lecture_list` — real 4lek canonical PASS;
- `weekly_grid` — geometry/canonical PASS для publishable групп, 26/40 после уже approved reviews;
- `cycle_rotation_grid` — geometry/canonical реализован, но 485/486 blocked одной O20 source inconsistency;
- `combined_rotation_table` — group 585 full canonical PASS.

## Следующий шаг

Собрать profile completeness/orchestration layer для группы/курса. В частности, 4 курс должен требовать одновременно `course_lecture_list + cycle_rotation_grid`: нельзя публиковать lecture-only batch, если required cycle profile отсутствует или blocked. После этого перейти от отдельных profile regressions к group-level canonical candidate/publishability и только затем выводить legacy direct-S3 path из production контура.
