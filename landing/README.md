# Landing КГМУ

Product-MVP landing КГМУ сохраняет визуальную структуру, продающий текст, CSS и интерактивный пример календаря из сохранённой на Google Drive страницы `Расписание КГМУ в Apple и Google Calendar.html` и соседней папки `_files`.

## Что сохранено буквально

Из Google Drive без дизайнерской переработки перенесены:
- `styles.css`;
- `pricing.css`;
- `landing-v1.css`;
- `landing-feed.css`;
- `program-status.css`;
- `trial.css`;
- сохранённый Google Fonts stylesheet (`css2` → `fonts.css` только для корректного MIME/имени файла);
- `landing-preview.js` с Apple/Google demo, днями 16–18 марта и event-detail interaction;
- исходные marketing/FAQ/policy/hero тексты и статический пример календаря в HTML.

CI фиксирует SHA-256 этих сохранённых визуальных assets, чтобы последующие изменения не могли незаметно переделать исходный дизайн.

## Что удалено как legacy старого проекта

Не перенесены runtime-зависимости прежнего контура:
- `data.js` с `kgmu-calendar-api.containerapps.ru`;
- `program-status.js` с `/api/v2/meta` и `/api/v2/catalog/...`;
- `analytics.js` с legacy `/api/v2/analytics`, payments/trials/orders tracking;
- `app-utils.js` со старой моделью order/access-token/localStorage;
- отсутствующий в Drive старый локальный `file:///.../app.js`;
- блок `saved-orders`, относящийся к старой order/localStorage модели.

Иностранные обучающиеся удалены только потому, что текущий product scope проекта — лечебное дело, педиатрия и стоматология.

## Текущая интеграция

`landing/app.js` не меняет сохранённый hero/demo/marketing layout и подключает только актуальный проектный слой:
- versioned `catalog/2026-2027-semester-1.json`;
- текущий `POST /trial` contract;
- same-origin API по умолчанию;
- существующую `/manage/` страницу proof-of-email/recovery.

`runtime-config.js` остаётся fail-closed:
- `trialEnabled=false`;
- `managementEnabled=false`;
- `checkoutEnabled=false`;
- `apiBase=""`.

Production domain/origin, Resend secret, migrations, nginx routing и включение trial/management выполняются отдельным controlled production этапом.
