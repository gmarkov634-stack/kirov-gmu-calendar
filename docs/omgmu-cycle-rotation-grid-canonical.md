# ОмГМУ — `cycle_rotation_grid`: geometry → canonical migration

Статус: **PROFILE MIGRATION ЗАВЕРШЕНА В ИЗОЛИРОВАННОЙ ВЕТКЕ; ОБЕ ГРУППЫ ОСТАЮТСЯ FAIL-CLOSED ИЗ-ЗА ОДНОЙ SOURCE-НЕСОГЛАСОВАННОСТИ**.

Правила O01–O72 не изменялись.

## Официальный источник

`07_medicine-international_course-4_cycles.pdf` (`4zan.pdf`)

SHA-256:

`d3436fb8a1f40b4286ffd550004e477424c9424590128dbbf564340200c38daa`

Production parsing использует только русские страницы 3–4 по O64.

Русский источник содержит:

- цикл 1: `07.05–31.07 — без субботы`;
- цикл 2: `29.05–30.07 — без субботы`;
- группы 485 и 486;
- merged group cells;
- отдельные lecture/cycle строки;
- многослотовые циклы;
- `К.дн.`;
- зачёты, в том числе с отдельным временем и в последний день основного диапазона.

## Geometry boundary

Добавлен:

`api/tools/omgmu-extract-cycle-geometry.py`

Extractor через `pdfplumber` берёт именно русскую часть PDF и сохраняет:

- cycle number и local envelope;
- `без субботы`;
- table/group column geometry;
- discipline, time и `К.дн.` по конкретной geometric row;
- group cells с exact bbox и физически покрытыми группами.

Это устраняет исторические fixed text offsets и позволяет корректно увидеть merged cell `485+486` у первых строк факультетской терапии.

Реальный regression snapshot сохранён в:

`api/test/fixtures/omgmu-cycle-rotation-course4.geometry.json.gz.b64`.

## Evidence-rich parser и canonical composer

Добавлен:

`api/src/adapters/omgmu/cycle-rotation-grid.mjs`.

Parser формирует independent logical source records и сохраняет:

- discipline;
- cycle number/id;
- exact group span;
- original time slots;
- main source range;
- expanded working dates;
- explicit control/credit date and optional own time;
- declared `К.дн.`;
- raw source;
- page/cycle/row/bbox/group references;
- O-rule IDs;
- status/warnings.

Calendar year и calendar exceptions передаются извне; новый parser не имеет собственного hardcoded 2026 holiday set.

## Подтверждённые правила в реализации

### O16 / O43

Групповая принадлежность определяется physical PDF geometry, а не позицией layout text.

Первые строки `Факультетская терапия, профессиональные болезни` имеют одну merged group cell, физически покрывающую 485+486.

### O26

Вторая строка той же дисциплины наследует discipline из объединённой левой ячейки.

### O19 / O53

Реальный двухслотовый цикл:

`08:20–09:50; 10:00–11:30`

сохраняется в source record как два `sourceSlots`, но для пользователя материализуется одним событием `08:20–11:30` на каждой дате. Regression на `Факультетская хирургия, урология`, группа 485, проходит общий canonical pipeline и ICS.

### O20 / O30

`К.дн.` проверяется после разворачивания main dates и добавления отдельной control date по unique dates.

Пример `Оториноларингология`, группа 485:

- основной диапазон `17.06–01.07` → 11 рабочих дат;
- зачёт `29.07`, отдельное время `08:20–11:30`;
- unique dates = 12;
- `К.дн.=12` → PASS.

### O37 / O42

Явное время зачёта становится временем отдельного canonical credit event.

### O29

`Основы репродуктологии`, группа 485:

- цикл `20.07–29.07`;
- зачёт `29.07` без собственного времени;
- `К.дн.=8`.

На 29.07 создаётся один credit event `12:50–16:00` вместо параллельных `cycle + credit`; всего остаётся 8 событий.

### O44 / O51

`(лекции)` и `(циклы)` задают явный source type. Строки без явного marker внутри cycle block консервативно трактуются как cycle по O51; canonical type для structural `cycle` остаётся `unknown`, а не автоматически `practice`.

## Полный source-layer audit

Добавлен:

`api/tools/omgmu-cycle-rotation-report.mjs`.

Workflow `ОмГМУ source discovery` теперь:

1. скачивает официальный `4zan.pdf`;
2. извлекает Russian geometry;
3. запускает parser audit;
4. сохраняет `omgmu-cycle-rotation-geometry.json` и `omgmu-cycle-rotation-report.json` в отдельный artifact.

Итог run #294:

- cycle blocks: 2;
- groups: 2;
- source records: **18**;
- unresolved diagnostics: **0**;
- group 485: 10 source records, 1 needs_review;
- group 486: 10 source records, 1 needs_review;
- source-layer publishable groups: **0/2**.

## Единственный blocker

Русская merged row для обеих групп:

`Факультетская терапия, профессиональные болезни | 10:40–13:50 | К.дн. 15 | 07.05–28.05 (циклы)`.

При разворачивании 07.05–28.05 по рабочим дням с source calendar exceptions, явно переданными из PDF metadata, получается **16** дат, а источник указывает `К.дн.=15`.

Source reference:

`pdf:p3:cycle-1:row-4:bbox-265.08,190.47,556.01,228.15:groups-485+486`.

Parser ставит O20 `needs_review`; он не удаляет одну дату, не подменяет source holiday calendar и не игнорирует `К.дн.`. Поскольку cell merged на 485+486, blocker затрагивает обе группы.

Полный candidate группы 485 содержит 10 source records / 107 materialized canonical events, но общий input QA корректно блокирует публикацию из-за этой одной source-series.

## Regression

`api/test/omgmu-cycle-rotation-canonical.test.js` проверяет:

- Russian geometry и merged group span;
- 18 source records / 10 records на группу;
- exact O20 blocker 15 против 16;
- O19 multi-slot materialization + common QA/ICS;
- отдельный explicit-time credit;
- O29 same-day credit replacement;
- full group fail-closed;
- non-Russian geometry rejection.

## Коммиты

- `76f0ba8ff4de4c527c4a5e9c8b5fbf5d4f9fbc35` — cycle geometry extractor;
- `04b9dc713163b13461de7e5c0ad93879ed59a24c` — evidence-rich parser/canonical composer;
- `c27c1d94d09a8f412cda58e0e3878efa1ba1988d` — real geometry fixture;
- `f730d332f10f0016782508ca1fc7a49d223b07e1` — canonical regressions;
- `cf63e36d0fb97131eb6fa6e648ec739fa8fd3b4b` — source QA report;
- `c499d0c6eab83d73a956f58064e9175d41387cde`, `8e8d99f58ee59fc6e36fdaadced8233e906e71f2` — source-discovery extraction/report integration.

## CI

На final implementation head `8e8d99f58ee59fc6e36fdaadced8233e906e71f2`:

- API tests #879 — **SUCCESS**;
- ОмГМУ source discovery #294 — **SUCCESS**;
- `Extract authoritative cycle_rotation_grid geometry` — SUCCESS;
- `Analyze cycle_rotation_grid geometry` — SUCCESS;
- artifact `omgmu-cycle-rotation-geometry` создан успешно.

## Ограничение и следующий шаг

Profile migration технически завершена, но 485/486 нельзя переводить на canonical publication, пока O20 blocker не разрешён source-bound способом.

Следующий profile migration: `combined_rotation_table` (`5.pdf`, группа 585) → geometry/page-continuation O69 → canonical boundary → common pipeline. Blocker 4 курса остаётся отдельным review backlog и не должен тормозить миграцию следующего source profile.
