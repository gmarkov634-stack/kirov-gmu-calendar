# Бесплатная проба календаря

Backend trial реализован в PR #100. Production-доступ закрыт по умолчанию и открывается только точным `TRIALS_ENABLED=true`. Frontend и production smoke — следующий этап; до этого trial не рекламируется как доступная функция.

- Trial и paid используют один canonical schedule и один tokenized endpoint `/api/v1/subscriptions/{token}/calendar.ics`.
- `entitlement=trial` показывает фиксированную первую учебную неделю; `entitlement=paid` — весь оплаченный период. Старые version-2 записи без entitlement остаются paid-compatible.
- Trial и paid всегда имеют разные приватные token. Trial token никогда не превращается в paid token.
- `trialStartDate` — первая фактическая дата занятия; `trialEndDateExclusive` — +7 календарных дней. Повторные trial не сдвигают окно.
- Derived-поля (`X из N`, academic week, next_same_event и др.) рассчитываются по полному расписанию до фильтрации и не пересчитываются.
- Создание trial fail-closed для неопубликованной группы, неверного offer period, пустого расписания и после окончания фиксированной первой недели.
- `conversionId` непривилегированный. Storage key: `trial-conversions/<sha256(conversionId)>.json`. Continue API не раскрывает subscription token/hashes.
- `TRIALS_ENABLED` default=false, независим от `COMMERCIAL_SALES_ENABLED`; `/api/v2/meta` отдаёт `trials: open|closed`.
- Trial feed фильтрует текущую подтверждённую публикацию и добавляет одно детерминированное all-day событие `Продолжить календарь на семестр`; оно не записывается в canonical `current.json`. Revoked/upgraded trial feed содержит 0 VEVENT.
- При создании сначала пишется non-privileged conversion context, затем live entitlement: сбой первой записи не оставляет рабочий trial URL.
- Checkout принимает optional `conversionId` только при точном совпадении university/program/course/stream/group/year/semester. Raw conversionId в order не хранится.
- После `payment.succeeded` сначала создаётся новый полноценный `entitlement=paid` на весь период и completed order; затем linked trial отзывается и conversion record помечается `upgraded`. Retry cleanup идемпотентен.
- Direct purchase сохраняет прежний поток (`purchasePath=direct_purchase`).

Основные файлы: `trial-projection.js`, `trial-service.js`, `trial-store.js`, `trial-http-handler.js`, изменения `config.js`, `server.js`, `app.js`, `yookassa.js`.

Regression покрывает exclusive day 8, canonical/legacy projection, derived counters, repeated/closed/wrong-period trial, hashed storage, fail-closed write ordering, safe continue, runtime ICS, mismatch conversion, отсутствие raw conversionId в order, full paid entitlement, retire trial, idempotent fulfillment, direct/legacy paid compatibility и точный gate. Последний кодовый GitHub Actions `API tests` run #917 = SUCCESS; после него менялся только этот документ.

Следующий этап после merge: frontend group preview → trial creation → connect → continue/offer → checkout → paid connect, затем ограниченный E2E smoke и только потом production enable.
