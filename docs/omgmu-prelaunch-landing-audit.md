# ОмГМУ — prelaunch landing structural audit

Дата: 17.08.2026.

Статус: **PASS / STRUCTURAL + MOBILE CONTRACT / CURRENT-GROUP DEVICE SMOKE WAITING**.

## Цель

Проверить всё, что можно безопасно зафиксировать на лендинге ОмГМУ до появления официального расписания `2026/2027 + autumn`, не выдавая historical data за current offer и не открывая продажи.

## Проверено

### Commercial fail-closed

- runtime по умолчанию имеет `sales=closed`;
- submit изначально disabled;
- form submit отдельно блокирует checkout при `runtime.sales !== 'open'`;
- программы/курсы/группы берутся только из server-owned `/api/v2/catalog/omgmu/...`;
- статический `groups.js` отсутствует;
- static commercial authority `checkoutEnabled`, `priceRub`, `testMode` отсутствует;
- при ошибке/пустом groups catalog выбор группы остаётся закрытым;
- historical groups не имеют client-side fallback;
- payment context строится из exact live `groupId/groupCode/course/stream`.

### Mobile/iPhone/Safari structural contract

В `site/omgmu/mobile.css` закреплены:

- защита от horizontal overflow;
- `-webkit-text-size-adjust: 100%`;
- form controls с `font-size: 16px`, чтобы Safari не выполнял нежелательный auto-zoom;
- touch targets / `touch-action: manipulation`;
- `safe-area-inset-bottom`;
- отдельный узкий breakpoint до 390 px;
- landscape handling;
- `prefers-reduced-motion`.

Это теперь проверяется regression `api/test/omgmu-prelaunch-landing.test.js` и входит в агрегирующий `npm run readiness:omgmu`.

### CSS cleanup

До аудита `mobile.css` подключался дважды: напрямую в HTML и динамически из `site/omgmu/config.js`. Динамический loader удалён. CI теперь требует:

- ровно одно `mobile.css` подключение в HTML;
- отсутствие динамической инъекции stylesheet из config.

## CI evidence

После исправления тестового assertion:

- OmGMU structural launch readiness run `32042030181` — **SUCCESS**;
- API tests run `32042030191` — **SUCCESS**;
- GitHub Pages build/deployment run `32042030219` на SHA `aa47468ff485536004594204b1aa3650e1daa043` — **SUCCESS**.

После синхронизации отдельного landing CI-контракта с single-stylesheet architecture:

- Medical university landings run `32042165228` на SHA `b66c1d75413032f0a4c40026c5e901bc097ff186` — **SUCCESS**, включая validation и Pages deployment.

Первый красный landing run был вызван устаревшим CI-assertion, который требовал уже удалённый dynamic mobile stylesheet loader. Production commercial/mobile semantics при этом не ослаблялись.

## Что намеренно не считается выполненным

До появления current-period группы нельзя закрыть:

- физический smoke на реальном iPhone/Safari с live catalog group;
- Android/Chrome smoke с live group;
- реальный payment-return path на current-period checkout;
- отображение backend-issued subscription URL после current-period payment;
- wording launch-state после фактической публикации групп.

Эти пункты остаются в `docs/omgmu-launch-gate.md` и `docs/omgmu-first-current-group-runbook.md`.

## Итог

До появления расписания 2026/27 лендинг ОмГМУ структурно готов: server-owned catalog, fail-closed checkout и mobile/iPhone layout contract защищены regression и CI. Current-group device/payment smoke остаётся честно отложенным до первого QA-approved current schedule.
