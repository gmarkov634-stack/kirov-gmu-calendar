# Landing КГМУ

Static mobile-first landing для КГМУ. Визуальная и контентная основа перенесена из сохранённого Google Drive HTML «Расписание КГМУ в Apple и Google Calendar», но runtime wiring приведён к актуальным `medical-calendar-core` contracts.

## Scope

Только:
- лечебное дело;
- педиатрия;
- стоматология.

Каталог групп загружается из `catalog/2026-2027-semester-1.json`.

## Runtime flags

`runtime-config.js` по умолчанию fail-closed:
- `trialEnabled=false`;
- `managementEnabled=false`;
- `checkoutEnabled=false`;
- `apiBase=""` означает same-origin API.

До production deploy кнопки не могут создать trial/management session/checkout.

## Trial

Когда `trialEnabled=true`, landing отправляет ровно:
`email`, `universityId`, `groupId`, `academicYearId`, `academicPeriodId`
в `POST /trial`.

Backend повторно проверяет published ScheduleVersion scope и только после этого создаёт 7-дневный CalendarSubscription/Entitlement.

## Management

`manage/` реализует browser flow:
1. `POST /management/link`;
2. magic link приходит на `.../manage/#token=<credential>`;
3. fragment читается JS и очищается из адресной строки;
4. `POST /management/verify`;
5. management session остаётся в Secure/HttpOnly/SameSite=Strict cookie API;
6. `GET /management/subscriptions`;
7. явный `POST /management/recover` ротирует ICS token;
8. `POST /management/logout`.

Новая ICS-ссылка показывается только как результат явной recovery-операции.

## Production boundary

Финальные domain/origin, API base, Resend sending domain/API key, migrations, nginx routing и enable flags на live VM задаются отдельным controlled production этапом.
