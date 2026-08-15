# ОмГМУ — `weekly_grid`: source-layer аудит всех текущих PDF

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОЙ ВЕТКЕ**.

Правила O01–O72 не изменялись. Аудит выполняется до применения ранее подтверждённых manual-review решений.

## Область

Проверены все пять текущих русских `weekly_grid` источников:

1. `1.1.pdf` — группы 1101–1106;
2. `1.2.pdf` — 1107–1112;
3. `2.1.pdf` — 2101–2110;
4. `2.2.pdf` — 2111–2120;
5. `3.pdf` — 385, 386, 387, 388, 389, 393, 394, 395.

Geometry извлекается из русской страницы PDF и является источником групповой принадлежности по O16.

## Итог raw source layer

Workflow report на 15.08.2026:

- PDF: **5**;
- групп: **40**;
- независимых source-series: **272**;
- source-series со статусом `needs_review`: **10**;
- потерянных/unresolved diagnostics: **0**;
- подтверждённых O65 merge occurrences: **2** (группы 1109 и 1110 на 20.07);
- групп без blocking source-series: **22/40**;
- групп, требующих source/manual review: **18/40**.

## Группы, чистые на raw source layer

`2.1.pdf`: все 10 групп:

`2101–2110`.

`2.2.pdf`:

`2111, 2112, 2117, 2118, 2119, 2120`.

`3.pdf`:

`385, 386, 387, 388, 394, 395`.

Итого: **22 группы**.

## Заблокированные группы и точные причины

### `1.1.pdf` — 1101–1106

Все шесть групп затронуты O06:

- `История медицины`, 15:40–17:20, 6 лекций 06.04–11.05;
- `Основы паразитарных заболеваний`, 15:40–17:20, те же даты.

Обе записи находятся в одной full-width geometry cell всех групп и имеют одинаковые даты/время, но разные дисциплины/места. Geometry не доказывает распределение между студентами, поэтому parser не выбирает одну серию и не публикует обе параллельно.

Дополнительно:

- 1101–1102: `Ин. язык (рус. язык), 5 зан.: 07.04–14.07`; Tuesday expansion даёт 15 дат → O57.
- 1103–1104: `Гистология, эмбриология, цитология, 17 з.: 09.04–29.07`; Thursday expansion даёт 16 дат → O57.

### `1.2.pdf` — 1107–1112

Все шесть групп затронуты O06:

- `Психологические основы деятельности врача`, 11:00–12:40, 06.04–11.05;
- `Биоэтика`, 11:00–12:40, те же даты.

Обе series физически лежат в одной full-width merged cell всех шести групп. Автоматическое распределение запрещено.

Дополнительно общий O57 blocker:

`Спортивные игры/Плавание/Атлетическая гимнастика, 5 занятий: 23.06–14.07` в Tuesday block содержит только 4 вторника: 23.06, 30.06, 07.07, 14.07.

O65 для 1109–1110 при этом работает независимо: гистология 20.07 материализуется 13:30–18:25, но O65 не устраняет перечисленные source blockers.

### `2.2.pdf` — 2113–2116

2113–2114:

`Биохимия, 16:20–18:45, 13 з.: 09.04–02.07` расположена в Friday structural block, тогда как границы диапазона соответствуют четвергам. При O04 Friday expansion и source exceptions получается 10 дат вместо 13 → O57/source-weekday-date mismatch.

Для этих групп уже существует ранее утверждённый source-bound manual review с точным SHA исходника; raw source audit намеренно не применяет его и поэтому показывает группы blocked.

2115–2116:

русский PDF буквально содержит `Топ. анатомия и ОХ/**, 710 зан.: 09.04–30.07`. Это не ошибка geometry extractor: `pdftotext` и rendered PDF подтверждают отсутствие `/` между 7 и 10 в данной ячейке, тогда как соседняя ячейка 2113–2114 содержит `7/10 зан.`. Автоматически превращать `710` в `7/10` без отдельного source-bound решения нельзя; O57 фиксирует несогласованность с 17 четвергами.

### `3.pdf` — 389, 393

В Thursday geometry cell групп 389+393 явно напечатано:

`14:20–16:00 Спортивные игры/Плавание/Атлетическая гимнастика, 1 з.: 24.06`.

24.06.2026 — среда. Явная дата теперь не теряется: parser сохраняет `2026-06-24`, но ставит `weekday mismatch → needs_review`. Таким образом blocker относится только к 389/393, а не ко всем восьми группам PDF.

Для 389/393 уже существует ранее утверждённый source-bound manual review, который сохраняет именно явно напечатанную дату 24.06.2026; raw audit его намеренно ещё не применяет.

## Исправление QA-точности

Первый report ошибочно представлял course-3 singleton `24.06` как unresolved diagnostic и из-за глобального diagnostic flag блокировал все восемь групп `3.pdf`.

Исправление `d6266547`: explicit singleton date при weekday mismatch сохраняется как дата source-series, а противоречие становится `needs_review`. Regression `ccdd6bd2` закрепляет `24.06.2026` для groups 389+393 без потери серии.

После исправления diagnostics = **0**, source-series = **272**, raw publishable groups = **22**.

## Автоматический отчёт

Добавлен:

`api/tools/omgmu-weekly-geometry-report.mjs`

Workflow `ОмГМУ source discovery` выполняет report после geometry extraction и прикладывает `omgmu-weekly-geometry-report.json` к artifact `omgmu-weekly-geometry`.

Report содержит per-file/per-group:

- число source-series;
- число `needs_review`;
- O65 merge count;
- source-layer publishability;
- точные blockers с group span, discipline, time, dates, rules, warnings, raw source и PDF references.

## Коммиты

- `6ca2de0fdf4e2562aa1d2d3b737d0a7bacd3fe3e` — weekly geometry QA report;
- `b2e92dfc7fd7e933aa114815b82d2d37bd0e353d` — report в source-discovery workflow;
- `d6266547b11c971ec83f2ee370cfe7b7208396b2` — preserve explicit singleton on weekday mismatch;
- `ccdd6bd29294925d0c8fa83e444bd921d6be4fdd` — weekday-mismatch regression.

API tests на `ccdd6bd29294925d0c8fa83e444bd921d6be4fdd`: #860 — **SUCCESS**. Source-discovery #275 успешно выполнил новый `Analyze weekly_grid geometry` step и создал corrected report; полный workflow завершение проверяется отдельно.

## Следующий шаг

Применить к новой geometry/canonical ветке уже существующие approved source-bound manual reviews для 2113, 2114, 389 и 393 с обязательной проверкой exact `sourceFile + sourceSha256`. После этого пересчитать reviewed publishability. Нерешённые 1-курсные O06/O57 и `2115–2116: 710 зан.` остаются fail-closed и требуют отдельного доказательства/ручного решения; никакая коррекция по английской части не допускается.
