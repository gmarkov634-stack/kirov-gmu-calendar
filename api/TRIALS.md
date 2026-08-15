# Бесплатная проба календаря

## Статус

Backend trial реализован в PR #100 и прошёл полный API regression на финальном head. Production-доступ при этом остаётся закрыт по умолчанию: создание trial возможно только при явном `TRIALS_ENABLED=true`.

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

Default — `false`. Только точное `true` разрешает создание trial.

`TRIALS_ENABLED` независим от `COMMERCIAL_SALES_ENABLED`, поэтому trial можно тестировать при закрытых коммерческих продажах.

`GET /api/v2/meta` возвращает:

```json
{
  "trials": "open | closed"
}
```

## Trial feed

Маршрут остаётся прежним:

```text
GET /api/v1/subscriptions/{token}/calendar.ics
```

Server перехватывает только записи с `entitlement=trial`; paid и legacy subscriptions продолжают идти через прежний handler.

Для активного trial:

1. загружается текущая подтверждённая публикация группы;
2. проверяется точное совпадение university/program/course/stream/group/year/semester;
3. события фильтруются по сохранённому окну;
4. derived/calendar поля исходных занятий не меняются;
5. добавляется ровно одно синтетическое all-day событие `Продолжить календарь на семестр`.

Conversion event существует только в feed projection и не записывается в canonical `current.json`. Его UID детерминирован от `conversionId`, поэтому повторные fetch не создают новые события.

Revoked/upgraded trial feed содержит 0 VEVENT.

## Порядок записи при создании

Сначала сохраняется непривилегированный conversion context, затем создаётся live subscription entitlement.

Это специально сделано fail-closed: если запись conversion context не удалась, рабочего trial URL не существует. Если позже не удалась запись subscription, возможен только нераскрытый orphaned conversion context, который сам по себе доступа к календарю не даёт.

## Trial → paid

`POST /api/v2/payments` принимает необязательный `conversionId`.

Если он передан, backend разрешает его server-side и требует точного совпадения trial с покупаемыми university/program/course/stream/group/academic year/semester. Несовпадение блокируется до обращения к ЮKassa.

В order raw `conversionId` не сохраняется. Записываются только:

- `purchasePath: "trial_to_paid"`;
- SHA-256 conversionId;
- SHA-256 trial token;
- безопасный attribution.

Прямая покупка без trial сохраняет существующий поток и получает `purchasePath: "direct_purchase"`.

После `payment.succeeded`:

1. создаётся новый независимый paid token с `entitlement=paid` на весь приобретённый период, включая первую неделю;
2. completed order сохраняется;
3. связанный trial token отзывается;
4. conversion record помечается `upgraded`.

Такой порядок выбран намеренно: частичный сбой cleanup может временно оставить старый trial видимым, но не лишит оплатившего студента уже созданного paid-доступа. Повторный fulfillment идемпотентно повторяет cleanup и не создаёт второй paid subscription.

Ранее обсуждавшаяся схема «paid начинается только после trial_end» отменена: она делила один оплаченный семестр между двумя календарями и лишала paid-календарь истории первой недели.

## Sharing

Повторное создание trial не открывает следующие недели: все trial для одной опубликованной группы/периода показывают одно и то же фиксированное первое окно.

Trial token может быть переслан, но после покупки именно он не получает платные права. Покупателю выдаётся новый paid token, а linked trial отзывается.

## Реализованные файлы

- `src/trial-projection.js` — pure fixed-window projection;
- `src/trial-service.js` — создание trial, validation и safe continue context;
- `src/trial-store.js` — hashed local/S3 conversion storage и upgrade status;
- `src/trial-http-handler.js` — public API и entitlement-aware trial feed;
- `src/config.js` — `TRIALS_ENABLED`;
- `src/server.js` — runtime routing;
- `src/app.js` — `meta.trials` и forwarding `conversionId` в checkout;
- `src/yookassa.js` — trial-aware checkout, `entitlement=paid`, retire linked trial.

## Regression

Проверяются как минимум:

- day 8 не входит в бесплатное окно;
- canonical и legacy projection;
- derived counters не пересчитываются;
- repeated trial не сдвигает окно;
- trial после окончания окна не создаётся;
- неправильный период/неопубликованная группа fail-closed;
- conversion object хранится по SHA-256;
- storage failure conversion context не оставляет live entitlement;
- continue API не раскрывает hashes/token;
- runtime trial ICS содержит только первую неделю и одно promo event;
- checkout не принимает conversion другой группы;
- order не хранит raw conversionId;
- успешная оплата создаёт полноценный `entitlement=paid`;
- paid subscription не содержит trial window и остаётся самодостаточной на весь период;
- linked trial отзывается;
- fulfillment retry не создаёт второй paid calendar;
- direct purchase и существующие paid subscriptions сохраняют прежнее поведение;
- `TRIALS_ENABLED` открывается только точным `true` и не зависит от sales gate.

Финальный GitHub Actions `API tests` run #917 завершён SUCCESS на head `11115a9cbc42101a7d0b907842608388e4885347` перед этим чисто документальным обновлением. Код после run не менялся; изменена только эта строка статуса документа.

## Следующий этап

После merge backend остаётся закрытым (`TRIALS_ENABLED=false`). Далее требуется frontend: group preview → trial creation → platform-aware connect → continue/offer → checkout → paid connect. После этого проводится ограниченный E2E smoke на тестовой опубликованной группе, и только затем trial можно включать в production и использовать в маркетинге.
