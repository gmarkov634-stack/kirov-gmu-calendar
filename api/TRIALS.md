# Бесплатная проба календаря

Backend trial реализован в PR #100. Production-доступ остаётся закрыт по умолчанию и открывается только точным `TRIALS_ENABLED=true`. Frontend и production smoke — следующий этап; до этого trial не рекламируется как доступная функция.

## Инварианты

- Trial и paid используют один canonical schedule и один tokenized endpoint `/api/v1/subscriptions/{token}/calendar.ics`.
- `entitlement=trial` показывает только фиксированную первую учебную неделю; `entitlement=paid` — весь оплаченный период. Старые version-2 записи без entitlement остаются paid-compatible.
- Trial и paid всегда имеют разные приватные token; trial token никогда не становится paid token.
- `trialStartDate` — первая фактическая дата занятия; `trialEndDateExclusive` — +7 календарных дней. Повторный trial не сдвигает окно.
- Derived-поля (`X из N`, academic week, next_same_event и др.) рассчитываются по полному расписанию до trial-фильтрации и не пересчитываются.
- Trial создаётся только для опубликованной группы текущего `OFFER_ACADEMIC_YEAR/OFFER_SEMESTER` и только пока фиксированная первая неделя не закончилась.

## Conversion context

Trial получает отдельный случайный 43-символьный `conversionId`, который не даёт права на ICS. Storage key — `trial-conversions/<sha256(conversionId)>.json`. В conversion record хранится безопасный контекст группы/периода, attribution, окно trial и SHA-256 trial token; raw trial token не хранится.

API:

```text
POST /api/v2/trials
GET  /api/v2/trials/continue/{conversionId}
```

Continue API не возвращает `trialTokenHash`, `conversionIdHash` или subscription token.

## Feature gate

`TRIALS_ENABLED` default=false и открывается только точным `true`. Он независим от `COMMERCIAL_SALES_ENABLED`. `/api/v2/meta` отдаёт `trials: open|closed`.

## Trial feed

Server перехватывает только subscription records с `entitlement=trial`; paid/legacy records остаются на прежнем handler. Для trial берётся текущая подтверждённая публикация, проверяется точный context, события фильтруются по `[trialStartDate, trialEndDateExclusive)`, а затем добавляется одно детерминированное all-day событие `Продолжить календарь на семестр`. Оно существует только в feed projection и не записывается в canonical `current.json`. Revoked/upgraded trial feed содержит 0 VEVENT.

## Fail-closed storage

При создании сначала сохраняется непривилегированный conversion context и только затем live subscription entitlement. Ошибка первой записи не может оставить рабочий trial URL.

## Trial → paid

`POST /api/v2/payments` принимает необязательный `conversionId`. Он должен resolve в active trial той же university/program/course/stream/group/year/semester; mismatch блокируется до обращения к ЮKassa.

В order raw conversionId не сохраняется: только `purchasePath=trial_to_paid`, SHA-256 conversionId, SHA-256 trial token и безопасный attribution. Direct purchase получает `purchasePath=direct_purchase`.

После `payment.succeeded` сначала создаётся полноценный новый `entitlement=paid` на весь купленный период, включая первую неделю, и сохраняется completed order; затем linked trial отзывается и conversion record переводится в `upgraded`. Retry fulfillment повторяет cleanup идемпотентно и не создаёт второй paid subscription. Схема «paid начинается после trial_end» отменена: оплаченный календарь должен быть самодостаточным.

## Реализация

Основные файлы: `trial-projection.js`, `trial-service.js`, `trial-store.js`, `trial-http-handler.js`, а также изменения `config.js`, `server.js`, `app.js`, `yookassa.js`.

Regression покрывает exclusive day 8, canonical/legacy projection, derived counters, repeated/closed/wrong-period trial, hashed storage, storage failure ordering, safe continue, runtime ICS, mismatch conversion, отсутствие raw conversionId в order, full paid entitlement, retire trial, idempotent fulfillment, direct purchase/legacy paid compatibility и точный fail-closed gate.

Последний кодовый regression: GitHub Actions `API tests` run #917 = SUCCESS. После него менялся только этот документ.

## Следующий этап

После merge backend остаётся закрытым (`TRIALS_ENABLED=false`). Далее: frontend group preview → trial creation → connect → continue/offer → checkout → paid connect, затем ограниченный E2E smoke на тестовой опубликованной группе и только после него production enable.
