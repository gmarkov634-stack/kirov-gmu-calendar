# ОмГМУ — `weekly_grid`: O65 final-user-event materialization

Статус: **O65 РЕАЛИЗОВАН В ИЗОЛИРОВАННОЙ ВЕТКЕ; ПОЛНЫЙ `weekly_grid` ОСТАЁТСЯ ЗАБЛОКИРОВАН SOURCE-НЕОДНОЗНАЧНОСТЯМИ O06/O57**.

Правила O01–O72 не изменялись.

## Задача

После независимого geometry-разбора source-series реализовать подтверждённую O65 постобработку: несколько последовательных экземпляров одной дисциплины в один день могут дать одно пользовательское событие, но исходные counters/date expressions/bbox/evidence не должны исчезать.

## Реализация

Добавлен `api/src/adapters/omgmu/weekly-o65.mjs`.

`materializeWeeklyUserSeries()` работает после `parseWeeklyGeometry()` и перед `buildOmgmuCanonicalBatch()`.

Source-series сначала разворачиваются в one-date occurrences. Merge допустим только когда одновременно выполняются все условия:

- обе series имеют `status=ok`;
- одна группа и одна дата;
- одно normalized discipline;
- одинаковый lesson kind/type;
- одинаковый точный geometry group span;
- location/source note не конфликтуют;
- source records находятся на одной rendered PDF page и в соседних table rows;
- следующий слот начинается после окончания предыдущего;
- между ними нет другого occurrence;
- разрыв не превышает 5 минут — ровно текущий подтверждённый O65 паттерн `15:55 → 16:00`.

Порог намеренно не расширяется через metadata: более длинный break потребует нового source evidence, а не скрытой генерализации.

## Сохранение исходных series

Profile composer теперь имеет две границы:

`buildWeeklyGridCanonicalCandidate()` возвращает:

- `sourceSeries` — исходные независимые parser series;
- `userSeries` — one-date series после O65 materialization;
- `merges` — явный audit log O65;
- `batch` — canonical `schedule-batch/v1`, построенный по user layer.

`buildWeeklyGridCanonicalBatch()` остаётся удобным wrapper и возвращает только `batch`.

В merged occurrence сохраняется `sourceSeriesEvidence` для каждой исходной series: собственные start/end, dateExpression, declaredCount/unit, rawSource, O-rule IDs, geometry page/row/bbox/groups и references. Canonical событие дополнительно получает объединённые PDF references и оба raw source fragment, поэтому трассировка не теряется даже после materialization.

## Контрольный реальный пример 1.2.pdf

Группы: `1109–1110`.

Исходная series A:

- `13:30–15:55`;
- `Гистология, эмбриология, цитология`;
- `18 з.`;
- `06.04–03.08`;
- bbox `233.93,184.58,396.94,205.82`.

Исходная series B:

- `16:00–18:25`;
- та же дисциплина;
- `1 з.`;
- `20.07`;
- bbox `233.93,205.82,396.94,226.97`.

Parser по-прежнему возвращает две independent source-series с counters `18` и `1`.

Для группы 1109 O65 создаёт только на `20.07.2026` одно user event:

`13:30–18:25 — Гистология, эмбриология, цитология`.

Остальные 17 дат первой source-series остаются `13:30–15:55`.

Итог histology subset:

- source occurrences до merge: 19;
- canonical user events после O65: 18;
- 20.07 содержит ровно одно event;
- canonical event 20.07 содержит O65 и обе PDF references.

## Regression

Обновлён `api/test/omgmu-weekly-geometry-canonical.test.js`.

Проверяется:

- independent parser layer остаётся 2 source-series;
- structured counters/ranges сохраняются: `18 + 1`, `06.04–03.08` и `20.07`;
- audit `merges` содержит ровно один O65 merge;
- merged intermediate evidence содержит обе source-series;
- canonical 20.07 = `13:30–18:25` и имеет две PDF references;
- общий `prepareSchedulePublication()` проходит input QA → versioning → postprocessing → output QA → ICS;
- ICS содержит `DTSTART:20260720T133000` / `DTEND:20260720T182500` и больше не содержит отдельный `DTSTART:20260720T160000`;
- O65 не перескакивает через intervening event;
- O06/O57 `needs_review` по-прежнему не обходятся materialization.

## Коммиты

- `58062c87b0e9d094f0ea767745c635579bbf0c61` — structured declaredCount/dateExpression в weekly source-series;
- `a54a464b9739a047f6483920716b238b796a48c6` — O65 materializer;
- `cd7bef00273d566630b7ae0ba3436ad43c26a818` — O65 в weekly canonical candidate;
- `d458ec7ef09c1260b192a093ab0eea4ecee024a0` — regression O65/evidence/intervening event;
- `c55654c3fca0a71de243d98500a38e366b05993b` и `45bfd809d7e422a6723137cd07d03da58ffc6379` — conservative 5-minute verified boundary, без metadata widening.

API tests на implementation head `45bfd809d7e422a6723137cd07d03da58ffc6379`: #854 — **SUCCESS**.

## Что остаётся заблокировано

O65 не делает весь `1.2.pdf` publishable. Реальные source blockers остаются независимыми:

1. O06: full-width Monday cell содержит одновременно `Психологические основы деятельности врача` и `Биоэтика`, одинаковые группы/даты/11:00–12:40 без доказанной структуры распределения.
2. O57: Tuesday source объявляет `5 занятий: 23.06–14.07`, но диапазон содержит только 4 вторника.

Ни один из этих случаев O65 не исправляет и не должен исправлять.

## Следующий шаг

Провести source-review blocking O06/O57 на русскоязычных официальных данных. Если независимое русское доказательство однозначно разрешает конкретный case — применить существующие correction/review механизмы. Если доказательства нет — оставить affected series `needs_review` и продолжить миграцию других weekly PDFs, формируя точный список блокирующих групп/series перед полной canonical publication.
