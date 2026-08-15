# ОмГМУ — `course_lecture_list` → canonical

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОЙ ВЕТКЕ**.

## Цель

Подключить первый реальный PDF profile ОмГМУ к общей canonical boundary без ручного конструирования `source_series` и доказать прохождение того же `prepareSchedulePublication()`, который используется платформой КГМУ.

## Проверенный официальный snapshot

Источник: русский `4lek.pdf` для 4 курса «Лечебное дело для иностранных граждан», весенний семестр 2025/2026.

Snapshot из workflow `ОмГМУ source discovery`:

- artifact: `omgmu-source-pdfs`;
- локальное имя в artifact: `06_medicine-international_course-4_lectures.pdf`;
- SHA-256 PDF: `6e8cf99d14f53eb2a441cff588d39e619574863d8e5d12b08f4939113ac906fe`;
- русский source part визуально подтверждён на странице 2;
- regression fixture: `api/test/fixtures/omgmu-4lek-ru-2025-26.txt`, полученный из русского `pdftotext -layout` source part этого snapshot.

## Реализация

### Evidence-rich parser output

`api/src/adapters/omgmu/fourth-parser.mjs` сохраняет legacy API, но `parseFourthCourseLectures()` теперь выдаёт полноценные profile-level `source_series`:

- `discipline` / `disciplineRaw` / `disciplineNormalized`;
- `startTime`, `endTime`;
- resolved `dates` и исходный `dateExpression`;
- `declaredCount`;
- `structuralWeekday`;
- `location`;
- `kind=lecture`, `typeRaw=лекция`;
- `rawSource`;
- source `references`;
- фактически применённые `ruleIds`;
- `status` и `warnings`.

Rule evidence назначается консервативно по реально использованной семантике: базовые O24/O27/O64/O68, O31 для star-pattern, O72 для weekday inheritance, O66 для физического continuation, O58/O67 для доказанного location delimiter и O61 для составного date expression.

O64 усилен fail-closed: если русского heading нет, parser больше не возвращается к другой языковой части.

O27 теперь реально валидирует объявленное число лекций против числа развёрнутых дат. Несоответствие переводит series в `needs_review` и через canonical QA блокирует publication preflight.

### Profile → canonical composition

Добавлен `api/src/adapters/omgmu/course-lecture-list.mjs`.

`buildCourseLectureListCanonicalBatch(text, { metadata, source })`:

1. вызывает реальный `parseFourthCourseLectures()`;
2. запрещает молчаливый пустой результат (`OMG_COURSE_LECTURE_LIST_EMPTY`);
3. передаёт parser output в общий `buildOmgmuCanonicalBatch()`;
4. academic/group/source metadata получает извне orchestration и ничего не hardcode'ит.

## Regression result

`api/test/omgmu-course-lecture-list-canonical.test.js` проверяет фактический русский fixture `4lek.pdf`.

Результат parser:

- 20 независимых lecture `source_series`;
- 69 фактических дат/событий;
- все 20 series на этом snapshot имеют `status=ok`;
- во всех случаях `resolved date count == declared lecture count`;
- raw source и references сохранены.

Далее parser output без ручной перекладки проходит:

```text
4lek Russian source part
  -> parseFourthCourseLectures
  -> evidence-rich source_series
  -> buildCourseLectureListCanonicalBatch
  -> schedule-batch/v1
  -> prepareSchedulePublication
  -> input QA PASS
  -> versioning
  -> postprocessing
  -> output QA PASS
  -> ICS preflight
```

Для 69 canonical events подтверждены `university=omgmu`, `group=485`, source PDF hash/evidence и `time_mode=floating`. ICS содержит floating `DTSTART`, без `TZID=Asia/Omsk` и без `+06:00`.

Отдельные regressions подтверждают:

- O27 mismatch → canonical `needs_review` → `SCHEDULE_NOT_PUBLISHABLE` на input QA;
- English-only text → 0 series → fail-closed `OMG_COURSE_LECTURE_LIST_EMPTY`.

## Критический publication invariant

`course_lecture_list` является только одним source profile расписания 4 курса. **Lecture-only canonical batch не должен становиться `current.json` группы 485/486**, пока `cycle_rotation_grid` не мигрирован и обе части не собраны в полный group batch.

На этом шаге доказан profile-level canonical preflight, а не production publication полного расписания группы. Это защищает от случайного удаления цикловых занятий частичной публикацией.

## Актуальный план, шаг 2: fail-closed O66–O68

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОМ PR #99**.

- **O66:** неоднозначный физический continuation больше не принимается автоматически: series получает `needs_review`, статус доходит до canonical `parse.status`, общий input QA блокирует публикацию. Доказанные continuation-паттерны location остаются валидными.
- **O67:** location отделяется только при явном признаке места справа от завершённого date expression. Нерегулярные пробелы вокруг тире допустимы. Неоднозначный RHS не угадывается: `location` остаётся пустым и сохраняется warning. Кириллические `ауд.`, `ГК`, `ул.` распознаются Unicode-aware вместо ненадёжной JS `\b`-границы.
- **O68:** одинаковый временной слот не является identity series. Разные дисциплины с непересекающимися resolved dates остаются отдельными series; фактическое совпадение разных дисциплин на одной дате и времени переводит обе series в `needs_review` и блокирует common QA.

Отдельный regression `api/test/omgmu-course-lecture-fail-closed.test.js` покрывает семь сценариев O66–O68, включая реальный перенос `09.04-23.04 –` → `229 ауд. ГК. ул.Ленина,12`.

После усиления реальный fixture `4lek.pdf` обязан сохранять подтверждённый baseline: **20 source_series / 69 canonical events / все real-source series `status=ok` / полный `prepareSchedulePublication()` PASS / floating ICS**.

## Оставшийся технический долг profile parser

Исторический `fourth-parser.mjs` всё ещё содержит hardcoded 2026 holidays/year для date expansion. Legacy `buildFourthCourseSchedules()` также сохраняет старый `+06:00` output для обратной совместимости. Эти legacy поля не используются новой canonical boundary, но год/holiday context должен быть вынесен из parser перед production migration нового учебного периода.

## Коммиты

- `9f9104a6ba0d45d50ac120ac7174a7cffcf3ca3a` — evidence-rich lecture source series + O27/O64 fail-closed;
- `85ec8e46d2f923b63921021c78474d8cf71dae01` — `course_lecture_list` canonical composition;
- `d60235973d19f3a0483f99a18c4984c44298aaeb` — фактический русский fixture `4lek.pdf`;
- `99d78c459665fc1fd5d684b08e5d0502fedcdc1f` — real-source canonical/pipeline regressions;
- PR #99 — fail-closed O66–O68 поверх актуального cumulative OmGMU branch.

## Следующий шаг

Мигрировать `weekly_grid` в evidence-rich `source_series` и canonical boundary. На этом этапе нельзя считать O16 реализованным только по `pdftotext`: принадлежность merged cells должна определяться по реальной PDF geometry. Первый контрольный regression — известная геометрия `1.2.pdf` для групп 1107–1112, включая две независимые histology series 1109–1110 и последующую O65 post-series merge семантику.
