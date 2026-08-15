# Бесплатная проба календаря

Backend trial реализован в PR #100. Production-доступ закрыт по умолчанию и открывается только точным `TRIALS_ENABLED=true`. Frontend и production smoke — следующий этап; до этого trial не рекламируется как доступная функция.

- Trial и paid используют один canonical schedule и один tokenized endpoint `/api/v1/subscriptions/{token}/calendar.ics`.
- `entitlement=trial` показывает фиксированную первую учебную неделю; `entitlement=paid` — весь оплаченный период. Старые version-2 записи без entitlement остаются paid-compatible.
- Trial и paid всегда имеют разные приватные token. Trial token никогда не превращается в paid token.
- `trialStartDate` — первая фактическая дата занятия; `trialEndDateExclusive` — +7 календарных дней. Повторные trial не сдвигают окно.
- Derived-поля рассчитываются по полному расписанию до фильтрации и не пересчитываются.
- Создание trial fail-closed для неопубликованной группы, неверного offer period, пустого расписания и после окончания фиксированной первой недели.
- `conversionId` непривилегированный; storage key — `trial-conversions/<sha256(conversionId)>.json`; continue API не раскрывает subscription token/hashes.
- `TRIALS_ENABLED` default=false и независим от `COMMERCIAL_SALES_ENABLED`; `/api/v2/meta` отдаёт `trials: open|closed`.
- Trial feed фильтрует текущую подтверждённую публикацию и добавляет одно детерминированное all-day событие `Продолжить календарь на семестр`; revoked/upgraded trial feed содержит 0 VEVENT.
- При создании сначала пишется non-privileged conversion context, затем live entitlement.
- Checkout принимает optional `conversionId` только при точном совпадении контекста; raw conversionId в order не хранится.
- После `payment.succeeded` сначала создаётся полноценный новый `entitlement=paid` на весь период, затем linked trial отзывается и conversion record помечается `upgraded`. Retry cleanup идемпотентен.
- Direct purchase сохраняет прежний поток.

Основные файлы: `trial-projection.js`, `trial-service.js`, `trial-store.js`, `trial-http-handler.js`; изменения `config.js`, `server.js`, `app.js`, `yookassa.js`.

Regression покрывает fixed-window boundary, canonical/legacy projection, derived counters, fail-closed creation/storage, safe continue, runtime ICS, trial-to-paid, direct/legacy paid compatibility и feature gate. Последний кодовый GitHub Actions `API tests` run #917 = SUCCESS; после него менялся только этот документ.

Следующий этап после merge: frontend group preview → trial creation → connect → continue/offer → checkout → paid connect, затем ограниченный E2E smoke и только потом production enable.
