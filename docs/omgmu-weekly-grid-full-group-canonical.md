# ОмГМУ — `weekly_grid`: полный group canonical regression

Статус: **ЗАВЕРШЁН В ИЗОЛИРОВАННОЙ ВЕТКЕ**.

Правила O01–O72 не изменялись.

## Цель

Подтвердить, что новый geometry-based `weekly_grid` path работает не только на контрольном subset гистологии, а на полном реальном расписании группы из официального PDF:

`официальный PDF geometry → source-series → O65 user layer → schedule-batch/v1 → prepareSchedulePublication() → input QA → versioning → postprocessing → output QA → ICS`.

Для проверки выбраны две группы, которые по полному source-layer audit не требуют manual review.

## Группа 2101 — 2 курс, поток 1

Официальный source snapshot:

`03_medicine-international_course-2_stream-1_combined.pdf`

SHA-256:

`f34129fe1a98ca8935620fce10b3adab7ca3858e5f5e842fe38bcfc85491d3da`

Полная русская geometry сохранена как regression fixture:

`api/test/fixtures/omgmu-weekly-course2-stream1.geometry.json.gz.b64`

В fixture присутствуют все 10 групп PDF: `2101–2110`, все извлечённые weekly rows/cells и реальные PDF bbox/group spans.

Для 2101:

- manual review не применяется;
- все относящиеся к группе source-series имеют status не `needs_review`;
- canonical batch содержит полное расписание группы, а не subset;
- каждый event сохраняет exact source file/hash и `pdf:p2:...` geometry reference;
- все события имеют `time_mode=floating`;
- batch целиком проходит общий `prepareSchedulePublication()`;
- input QA = PASS;
- output QA = PASS;
- versioning назначает event IDs;
- postprocessing формирует calendar title/description;
- ICS содержит стабильные canonical events без `TZID=Asia/Omsk` и без `+06:00`.

## Группа 385 — 3 курс

Официальный source snapshot:

`05_medicine-international_course-3_combined.pdf`

SHA-256:

`5a77c3eaede8e32887bc8c768cb19b5aaa6d9506249b2484ffb0bbb2f3bc9427`

Полная geometry сохранена как:

`api/test/fixtures/omgmu-weekly-course3.geometry.json.gz.b64`

Fixture содержит все 8 групп PDF:

`385, 386, 387, 388, 389, 393, 394, 395`.

Группа 385 выбрана специально как чистая группа того же PDF, где 389/393 имеют source weekday/date inconsistency. Это подтверждает, что fail-closed review локализуется по реальному geometry group span и не блокирует незатронутые группы документа.

Для 385 полный canonical batch также проходит common input/output QA, versioning, postprocessing и ICS без manual review.

## Regression

Добавлен:

`api/test/omgmu-weekly-full-group-canonical.test.js`

Тесты декодируют полные geometry fixtures и проверяют для каждой группы:

- полный source-series набор группы;
- отсутствие `needs_review`;
- корректный `university=omgmu` и group context;
- floating timing;
- exact source filename/SHA;
- наличие PDF geometry references;
- полный common-core pipeline;
- сгенерированные event IDs и calendar fields;
- ICS без timezone conversion.

Это первый regression, доказывающий полный `weekly_grid` profile end-to-end на реальной чистой группе.

## Коммиты

- `670ad3fca4ef0cef1ef55fd94cf2b6e9b3273668` — full geometry fixture 2.1;
- `b43facf6ababc0f8f0110af87813c551adc1884a` — full geometry fixture 3 курса;
- `b99f5b66ba79b3264e9830684e810915762dd7ce` — full-group canonical regressions.

## CI

На implementation head `b99f5b66ba79b3264e9830684e810915762dd7ce`:

- API tests #871 — **SUCCESS**;
- ОмГМУ source discovery #286 — **SUCCESS**.

## Ограничение

Это подтверждает production-capable canonical path для **publishable weekly groups**, но ещё не переводит legacy weekly publisher на новый путь и не разрешает неоднозначные source cases.

Текущий reviewed-publishable weekly set остаётся 26/40 групп. 14 групп (`1101–1112`, `2115–2116`) остаются fail-closed review backlog.

## Следующий шаг

Мигрировать `cycle_rotation_grid` (`4zan.pdf`) в evidence-rich source-series → canonical boundary → common pipeline. После этого 4 курс сможет собираться из двух canonical profile layers (`course_lecture_list` + `cycle_rotation_grid`) без риска частичной lecture-only публикации.
