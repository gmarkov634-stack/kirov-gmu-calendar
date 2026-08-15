# ОмГМУ — `weekly_grid`: geometry boundary и canonical preflight

Статус: **ГЕОМЕТРИЧЕСКАЯ BOUNDARY O16 ЗАВЕРШЕНА В ИЗОЛИРОВАННОЙ ВЕТКЕ; ПОЛНЫЙ `weekly_grid` ЕЩЁ НЕ PUBLISHABLE**.

## Цель

Перевести принадлежность событий `weekly_grid` к группам с ненадёжной позиции текста `pdftotext -layout` на реальную PDF geometry и подключить полученные source-series к общей canonical boundary платформы КГМУ.

Правила O01–O72 не изменялись.

## Проверенный официальный источник

Контрольный PDF: `1.2.pdf`, локальное имя workflow snapshot:

`02_medicine-international_course-1_stream-2_combined.pdf`

SHA-256:

`f1964e264d14d4b31de3e72e4b3e1f77c5cc7d4972e2d6f3c408afba9a5417e7`

Русская таблица находится на странице 2. Render страницы является авторитетным визуальным доказательством структуры.

Групповые колонки страницы 2:

`1107 | 1108 | 1109 | 1110 | 1111 | 1112`

## O16: фактическая геометрия вместо text alignment

Добавлен `api/tools/omgmu-extract-weekly-geometry.py`.

Extractor использует `pdfplumber.find_tables()` и физические bbox ячеек/границ таблицы. Для каждой непустой ячейки сохраняются:

- page number;
- bbox ячейки;
- точный набор групповых колонок, физически перекрытых bbox;
- русский source text;
- structural weekday строки.

Production geometry допускается только из страницы с русским heading `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ`; отсутствие русской таблицы работает fail-closed.

Workflow `ОмГМУ source discovery` теперь извлекает geometry JSON для всех пяти текущих `weekly_grid` PDF и сохраняет отдельный artifact `omgmu-weekly-geometry`.

Проверенный run #255 успешно создал geometry для:

- 1.1: группы 1101–1106;
- 1.2: группы 1107–1112;
- 2.1: группы 2101–2110;
- 2.2: группы 2111–2120;
- 3: группы 385, 386, 387, 388, 389, 393, 394, 395.

## Контрольный O16/O65 пример: гистология 1109–1110

Реальная geometry `1.2.pdf` доказывает две разные source cells.

Первая:

- bbox `233.93,184.58,396.94,205.82`;
- физически покрывает только `1109 + 1110`;
- `13:30–15:55`;
- `Гистология, эмбриология, цитология`;
- `18 з.: 06.04–03.08`.

Вторая:

- bbox `233.93,205.82,396.94,226.97`;
- физически покрывает только `1109 + 1110`;
- `16:00–18:25`;
- та же дисциплина;
- `1 з.: 20.07`.

Поэтому group attribution больше не зависит от того, где `pdftotext` разместил текст внутри merged cell.

Regression fixture:

`api/test/fixtures/omgmu-1.2-ru-monday-geometry.json`

## Evidence-rich weekly source-series

Добавлен `api/src/adapters/omgmu/weekly-geometry.mjs`.

Parser принимает только `weekly_grid geometry/v1` с `sourceLanguage=ru` и формирует независимые source-series с:

- discipline raw/normalized;
- start/end time;
- resolved dates;
- location/source note;
- exact geometry-covered groups;
- raw source;
- PDF page/row/bbox/group reference;
- O-rule IDs;
- parse status/warnings.

Calendar year передаётся извне; новый geometry parser не содержит собственного hardcoded 2026. Source calendar exceptions также передаются orchestration metadata.

Для lecture count используется O27, для обычного count — O57. Совпадающие `group + date + exact time`, но разные дисциплины без подтверждённой структуры параллельности получают O06 / `needs_review`.

## Canonical composition

Добавлен `api/src/adapters/omgmu/weekly-grid.mjs`.

`buildWeeklyGridCanonicalBatch()`:

1. разбирает authoritative geometry;
2. выбирает только source-series, геометрически относящиеся к запрошенной группе;
3. переносит остальные группы merged cell в `lesson.joint_groups`;
4. блокирует unresolved geometry/parser diagnostics;
5. передаёт series в общий `buildOmgmuCanonicalBatch()`.

Никакого storage, ICS, versioning или коммерческой логики в profile adapter нет.

## O65 пока намеренно не выполняется

Две гистологические серии сначала остаются независимыми.

Для группы 1109 на 20.07 canonical preflight до O65 содержит:

- 13:30–15:55 — гистология;
- 16:00–18:25 — гистология.

Это соответствует O65: merge разрешён только после независимого разбора/валидации source-series. Сами bbox, counters и evidence не теряются.

На следующем этапе будет реализован отдельный final-user-event merge 13:30–18:25 с сохранением обеих исходных series/evidence.

## Common-core regression

`api/test/omgmu-weekly-geometry-canonical.test.js` проверяет:

- реальные bbox и группы 1109–1110;
- две независимые histology source-series;
- 18 дат первой серии и отдельную дату 20.07 второй;
- geometry reference в canonical evidence;
- `joint_groups=1110` в batch группы 1109;
- отсутствие преждевременного O65 merge;
- прохождение geometry-backed histology subset через общий `prepareSchedulePublication()`:
  `input QA → versioning → postprocessing → output QA → ICS`;
- floating DTSTART без `TZID=Asia/Omsk` и без `+06:00`;
- O64 rejection для non-Russian geometry.

## Выявленные реальные blockers полного `1.2.pdf`

Полный `weekly_grid` пока нельзя объявить автоматически publishable.

### O06 — одинаковая группа/дата/время, разные дисциплины

В понедельничной full-width merged cell источник одновременно содержит:

- `Психологические основы деятельности врача, 6 лекций: 06.04–11.05`;
- `Биоэтика, 6 лекций: 06.04–11.05`;

обе записи имеют `11:00–12:40` и одну и ту же геометрическую область всех шести групп. Из одной geometry нельзя доказать структуру параллельности/распределения. Новый parser не выбирает одну запись и не публикует обе молча: серии получают O06 / `needs_review`.

### O57 — source count не совпадает с датами

Во вторник источник содержит:

`08.30–10.10 Спортивные игры/Плавание/Атлетическая гимнастика, 5 занятий: 23.06–14.07`

В указанном вторничном диапазоне находятся только 4 даты:

`23.06, 30.06, 07.07, 14.07`.

O57 является контролем, а не генератором недостающей даты. Без отдельного однозначного русского официального доказательства серия остаётся `needs_review`. Regression подтверждает, что canonical batch доходит до общего input QA и блокируется `SCHEDULE_NOT_PUBLISHABLE`.

## Что не изменено

Legacy `weekly-parser.mjs`, `weekly-parser-blocks.mjs` и старый Python publication parser пока не удалены и всё ещё могут формировать legacy `+06:00` schedules. Новый geometry/canonical путь существует рядом с ними и **ещё не заменяет production publication**.

Полный `weekly_grid` не должен становиться `current.json`, пока blocking source cases не разрешены и O65 final-event layer не реализован.

## Коммиты

- `ea4a068220c2bea394390fa827b04c76c2d63077` — PDF geometry extractor;
- `556942e0d9a6dd8a27978145c8fd9c1dbc66d20f` — реальный Monday geometry fixture 1.2;
- `8cc025476f578ae1ef19161d6a1ebe309a10f940` — evidence-rich geometry parser;
- `c357633031ea58b22ffdbb78c0996fe435726ff2` — weekly canonical composer;
- `fa5e82c0d44a53963916ed48d84fd5b746a208f3` — O06 exact-slot fail-closed;
- `109c25547bd6bfd440219d88a39361d4c8885ae3` — geometry/canonical regressions;
- `7d9a1d63b57032cc6f5fb6e8ab1ad07112e2fd83` — source-discovery geometry extraction/artifact.

## Проверка

На head `7d9a1d63b57032cc6f5fb6e8ab1ad07112e2fd83`:

- `API tests` #839 — **SUCCESS**;
- `ОмГМУ source discovery` #255 — **SUCCESS**;
- geometry extraction step — **SUCCESS** для всех пяти текущих weekly PDFs;
- artifact `omgmu-weekly-geometry` создан успешно.

## Следующий шаг

Реализовать O65 как отдельную post-series/final-user-event операцию `weekly_grid`: две валидированные последовательные source-series одной дисциплины могут дать одно пользовательское событие, но исходные series/counters/bbox/evidence должны оставаться раздельными. После этого отдельно разобрать blocking O06/O57 source cases и только затем запускать полный `weekly_grid → canonical group batch` regression.
