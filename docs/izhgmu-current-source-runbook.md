# ИжГМУ — runbook первого актуального source set

Статус: **READY / WAITING FOR 2026/2027 AUTUMN SOURCE**

Дата: 2026-08-17.

## 1. Watcher обнаружил current-period source set

Убедиться, что `.github/workflows/izhgmu-source-watch.yml` завершился успешно и `current-target-report.json` содержит:

- `status=candidate`;
- `target.academicYear=2026-2027`;
- `target.term=autumn`;
- active scope только medicine courses 1–3;
- `failedCount=0`;
- непустой `sourceSetDigest`;
- для каждого member есть exact URL, filename и SHA-256.

Использовать artifact этого exact workflow run. Не заменять source bytes повторной загрузкой вручную без новой SHA-проверки.

## 2. Создать source-bound review

Через protected `Schedule review control` выполнить `review.create` с:

- `university=izhgmu`;
- `program=medicine`;
- `courses=[1,2,3]` либо фактическим подмножеством active scope;
- `academicYear=2026/2027`;
- `semester=autumn`;
- exact `sourceSet.digest`;
- exact source members.

Ожидаемый результат: `REVIEW_REQUIRED`. На этом этапе `current` не меняется.

## 3. Semantic review

ChatGPT разбирает exact official workbooks по текущим подтверждённым правилам. Для каждого изменившегося structural invariant необходимо новое source-specific решение или fail-closed blocker; historical layout не переносится молча.

Medicine 4–6 не добавлять в active package: они находятся в deferred scope.

## 4. Сформировать canonical-reviewed/v1

Package обязан содержать:

- `format=canonical-reviewed/v1`;
- `source_set_digest` exact как у review;
- `rules_revision`;
- полные `schedule-batch/v1` по публикуемым группам.

Каждый event должен сохранять exact `source.file_name`, `source.file_hash`, references и rule/warning provenance.

Не добавлять `source_set_digest` в `schedule-batch/v1`: shared schema не расширяется.

## 5. Submit без публикации

Сначала выполнить `review.submit`.

Ожидаемый результат: `READY_TO_PUBLISH`, canonical QA PASS. Проверить количество групп/событий и отсутствие неожиданных blockers.

`current` до сих пор обязан оставаться прежним/отсутствующим.

## 6. Explicit publish

Только после review результата выполнить отдельный `review.publish` через тот же OIDC control.

Проверить publication result по каждой группе: schedule version, previous version, content fingerprint и diff.

Если публикация оборвалась посередине, состояние `CANONICAL_PUBLICATION_PARTIAL` требует отдельного операционного разбора; не повторять слепо и не очищать current.

## 7. Post-publication smoke

Для первой current группы:

1. проверить live catalog exact group identity;
2. создать preview subscription;
3. получить ICS по backend-issued URL;
4. сделать контролируемое A→B изменение одного однозначного события;
5. подтвердить тот же UID и рост SEQUENCE;
6. выполнить B→A rollback;
7. подтвердить исходный content fingerprint после rollback;
8. отозвать preview token.

## 8. Commercial E2E

После subscription smoke, при специально контролируемом gate, провести YooKassa test payment → succeeded order → paid subscription URL → ICS. После теста временные доступы/подписку закрыть согласно операционному сценарию.

## 9. Launch decision

Watcher, review, publication или успешный E2E сами по себе не открывают продажи. Отдельно проверить current catalog, payment mode, university commercial gate, trial/sales policy и только затем принимать launch authorization.

## Failure cases

- exact target отсутствует → `waiting`, ничего не менять;
- часть source download failed → review-required, не публиковать;
- same URL/new SHA → новый source-set digest, новый review;
- unknown workbook structure → semantic review, без fallback;
- source исчез/404 → last-known-good current сохраняется;
- historical 2025/26 package → current publication boundary обязана отклонить;
- course 4–6 package → отклонить как deferred scope;
- source hash/package digest mismatch → отклонить до QA/publication.
