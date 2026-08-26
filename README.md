# kirov-gmu-calendar

Университетский контур Кировского государственного медицинского университета для платформы календарей расписаний.

## Ответственность репозитория

В этом репозитории находятся только КГМУ-специфичные компоненты:

- конфигурация официальных источников;
- каталог факультетов/курсов/групп;
- parser rules и mappings;
- fixtures;
- университетские QA-правила;
- landing;
- VK configuration.

Общие customers, commerce, trial, entitlements, subscriptions, token lifecycle, CalendarPreferences, postprocessing, parsing/publication contracts и Calendar/ICS API принадлежат `medical-calendar-core`.

## Контракт с core

Репозиторий должен отдавать нормализованные данные только по v1-контрактам `medical-calendar-core`. Вузоспецифичные правила не должны попадать в shared core.

## Статус

Bootstrap университетского контура. Production/Cloud.ru ещё не подключены.
