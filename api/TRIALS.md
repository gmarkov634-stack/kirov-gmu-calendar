# Бесплатная проба календаря

## Статус

Backend trial реализован в PR #100. Production-доступ остаётся закрыт по умолчанию: создание trial возможно только при явном `TRIALS_ENABLED=true`.

Frontend и production smoke относятся к следующему этапу; до их завершения бесплатная проба не должна рекламироваться как уже доступная пользователям.

## Цель

Trial даёт студенту реальный календарь первой учебной недели его группы без банковской карты. Отдельного формата календаря или параллельного backend нет: используется тот же опубликованный canonical schedule и тот же tokenized endpoint, что и для paid.

## Entitlement

Subscription record остаётся `version: 2` и получает additive-поле:

- `entitlement: "trial"` — только фиксированное демо-окно;
- `entitlement: "paid"` — весь оплаченный период.

Исторические version-2 paid records без `entitlement` остаются обратно совместимыми и продолжают обслуживаться прежним handler.

Trial и paid всегда имеют разные приватные token. Trial token никогда не превращается в paid token.

## Фиксированное окно

`trialStartDate` — минимальная фактическая дата занятия в опубликованном расписании группы.
`trialEndDateExclusive` — ровно +7 календарных дней.

В trial feed входят только занятия:

```text
trialStartDate <= event.date < trialEndDateExclusive
```

Окно сохраняется при создании и не сдвигается из-за повторного запроса trial или последующих исправлений расписания. Новая подтверждённая редакция может добавить, изменить или удалить занятия внутри уже сохранённого окна.

Новый trial не создаётся, если группа не опубликована для текущего `OFFER_ACADEMIC_YEAR/OFFER_SEMESTER`, расписание не содержит валидных занятий либо фиксированная первая неделя уже закончилась.

Derived-поля (`X из N`, учебная неделя, next_same_event и др.) считаются по полному расписанию до фильтрации и в trial не пересчитываются.

## Conversion context

Каждый trial получает отдельный случайный 43-символьный `conversionId`. Это непривилегированный идентификатор: он не открывает ICS и не является subscription token.

Storage key:

```text
trial-conversions/<sha256(conversionId)>.json
```

Запись содержит контекст группы/периода, attribution, фиксированное trial-окно и SHA-256 trial token. Raw trial token в conversion context не хранится.

Публичные API:

```text
POST /api/v2/trials
GET  /api/v2/trials/continue/{conversionId}
```

Continue API возвращает только безопасный контекст для восстановления уже выбранной группы на лендинге; `trialTokenHash` и `conversionIdHash` наружу не выдаются.

## Feature gate

```text
TRIALS_ENABLED=false
```

Default — `false`. Только точное `true` разрешает создание trial. Gate независим от `COMMERCIAL_SALES_ENABLED`.

`GET /api/v2/meta` возвращает `trials: open|closed`.

## Trial feed

Маршрут остаётся прежним:

```text
GET /api/v1/subscriptions/{token}/calendar.ics
```

Server перехватывает только записи с `entitlement=trial`; paid и legacy subscriptions продолжают идти через прежний handler.

Для активного trial сервер загружает текущую подтверждённую публикацию группы, проверяет точный context, фильтрует события по сохранённому окну, не меняет derived/calendar поля и добавляет ровно одно синтетическое all-day событие `Продолжить календарь на семестр`.

Conversion event существует только в feed projection и не записывается в canonical `current.json`. Его UID детерминирован от `conversionId`. Revoked/upgraded trial feed содержит 0 VEVENT.

## Порядок записи при создании

Сначала сохраняется непривилегированный conversion context, затем создаётся live subscription entitlement. Если первая запись не удалась, рабочего trial URL не существует. Если позже не удалась запись subscription, возможен только нераскрытый orphaned conversion context, который доступа к календарю не даёт.

## Trial → paid

`POST /api/v2/payments` принимает необязательный `conversionId`. Если он передан, backend требует точного совпадения trial с покупаемыми university/program/course/stream/group/academic year/semester. Несовпадение блокируется до обращения к ЮKassa.

В order raw `conversionId` не сохраняется. Хранятся `purchasePath: "trial_to_paid"`, SHA-256 conversionId, SHA-256 trial token и безопасный attribution. Прямая покупка без trial получает `purchasePath: "direct_purchase"`.

После `payment.succeeded` сначала создаётся новый независимый paid token с `entitlement=paid` на весь приобретённый период, включая первую неделю, и сохраняется completed order; затем linked trial отзывается и conversion record помечается `upgraded`. Повторный fulfillment идемпотентно повторяет cleanup и не создаёт второй paid subscription.

Схема «paid начинается только после trial_end» отменена: paid-календарь должен быть самодостаточным и содержать весь оплаченный период.

## Sharing

Повторное создание trial не открывает следующие недели: все trial одной группы/периода показывают одно и то же фиксированное первое окно. Расшаренный trial token после чужой покупки не получает paid entitlement.

## Реализованные файлы

- `src/trial-projection.js`
- `src/trial-service.js`
- `src/trial-store.js`
- `src/trial-http-handler.js`
- `src/config.js`
- `src/server.js`
- `src/app.js`
- `src/yookassa.js`

## Regression

Проверены: exclusive day-8 boundary; canonical/legacy projection; сохранение derived counters; repeated/closed/wrong-period trial; hashed conversion storage; fail-closed порядок записи; safe continue API; runtime trial ICS; mismatch conversion при checkout; отсутствие raw conversionId в order; полноценный `entitlement=paid`; отсутствие trial window в paid; retire linked trial; idempotent fulfillment retry; сохранение direct purchase и legacy paid поведения; точный fail-closed `TRIALS_ENABLED`.

GitHub Actions `API tests` run #917 = SUCCESS после последних изменений кода. Последующие commits меняли только этот документ.

## Следующий этап

После merge backend остаётся закрытым (`TRIALS_ENABLED=false`). Далее требуется frontend: group preview → trial creation → platform-aware connect → continue/offer → checkout → paid connect. После этого проводится ограниченный E2E smoke на тестовой опубликованной группе, и только затем trial можно включать в production и использовать в маркетинге.
