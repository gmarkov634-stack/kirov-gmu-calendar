# Персональные подписки КГМУ

## Как работает доступ

- Студент получает случайную приватную ссылку после оплаты.
- Токен закреплён за факультетом, курсом, группой, учебным годом и семестром.
- В бакете хранится не сам токен, а его SHA-256-хэш.
- После `expiresAt` API возвращает корректный пустой календарь. При очередном обновлении подписки старые занятия удаляются из календаря студента.
- Запись подписки после истечения срока удалять нельзя: она нужна для дальнейшей выдачи пустого календаря.
- Для досрочного отзыва измените `status` с `active` на `revoked`. Такой токен тоже начнёт возвращать пустой календарь.

## Структура Object Storage

```text
schedules/pediatrics/1/132.json
subscriptions/<sha256-токена>.json
```

## Создание подписки вручную

```bash
npm run create-subscription -- \
  --group=132 \
  --expires-at=2026-08-31T23:59:59+03:00 \
  --order-id=manual-test-132 \
  --output=subscription-output
```

Загрузите созданный JSON в папку `subscriptions` бакета. Приватную ссылку из `subscription-132.txt` передайте только покупателю.

## Переменные контейнера

```text
ENABLE_PUBLIC_ENDPOINTS=false
PUBLIC_SITE_URL=https://gmarkov634-stack.github.io/kirov-gmu-calendar/
```

При `ENABLE_PUBLIC_ENDPOINTS=false` прямые маршруты `/api/v1/groups/{group}/schedule` и `/api/v1/groups/{group}/calendar.ics` закрыты. Персональные маршруты продолжают работать.

## Автоматическая выдача после оплаты

API создаёт заказ, направляет студента на платёжную форму ЮKassa и принимает уведомление `payment.succeeded`. Перед выдачей ссылки сервер повторно получает платёж через API ЮKassa и сверяет статус, сумму, валюту, идентификатор заказа и платежа. Повторное уведомление создаёт тот же токен и не выдаёт второй доступ.

Дополнительные переменные контейнера:

```text
PUBLIC_API_URL=https://kgmu-calendar-api.containerapps.ru
YOOKASSA_SHOP_ID=<идентификатор магазина>
YOOKASSA_SECRET_KEY=<секретный ключ, хранить как секрет>
SUBSCRIPTION_SIGNING_SECRET=<случайная строка не короче 32 байт, хранить как секрет>
OFFER_PRICE=490.00
OFFER_EXPIRES_AT=2026-08-31T23:59:59+03:00
YOOKASSA_SEND_RECEIPT=true
RECEIPT_VAT_CODE=1
```

Webhook для события `payment.succeeded`:

```text
https://kgmu-calendar-api.containerapps.ru/api/v1/yookassa/webhook
```

`RECEIPT_VAT_CODE=1` означает «без НДС». Перед включением чеков проверьте ставку и способ формирования чеков в настройках конкретного магазина ЮKassa.

Новые приватные объекты в бакете:

```text
orders/<случайный-id>.json
subscriptions/<sha256-токена>.json
```
