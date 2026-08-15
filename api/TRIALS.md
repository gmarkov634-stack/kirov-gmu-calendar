# Бесплатная проба календаря

## Статус

Архитектурный контракт подготовлен. Runtime-код trial ещё не включён. До реализации и regression-тестов production-поведение существующих paid-подписок не меняется.

## Цель

Trial должен дать студенту реальный опыт использования календаря на первой учебной неделе его группы без банковской карты и без отдельного формата календаря.

Главный инвариант: trial использует тот же опубликованный canonical schedule и тот же tokenized subscription endpoint, что и paid. Отличается только entitlement и проекция доступных событий.

## Инварианты

1. `subscriptions/<sha256(token)>.json` остаётся единственным источником прав на tokenized ICS.
2. Существующие записи subscription version 2 без поля `entitlement` трактуются как `paid` для обратной совместимости.
3. Для trial вводится `entitlement: "trial"`; для новых платных записей явно записывается `entitlement: "paid"`.
4. Trial и paid всегда имеют разные subscription token.
5. Trial token никогда не превращается в paid token.
6. Повторное создание trial не открывает новые даты: окно фиксируется относительно первой учебной недели опубликованного расписания, а не относительно момента регистрации.
7. Trial не публикует собственную копию расписания. Каждый fetch использует текущий подтверждённый `current.json`, затем применяет сохранённое trial-окно.
8. Исчезновение/ошибка source не очищает trial: действует общий fail-closed инвариант последней подтверждённой публикации.
9. Subscription token не используется как marketing/analytics identifier.
10. До явного `TRIALS_ENABLED=true` создание trial закрыто.

## Окно trial

Trial относится только к текущему продаваемому семестру.

`trialStartDate` — минимальная дата фактического занятия в опубликованном расписании группы.

`trialEndDateExclusive` — `trialStartDate + 7 календарных дней`.

В feed входят занятия, для которых дата удовлетворяет условию:

```text
trialStartDate <= event.date < trialEndDateExclusive
```

Окно сохраняется в subscription record при создании и не пересчитывается при последующих редакциях расписания. Поэтому обновление расписания может добавить, изменить или удалить занятия внутри уже зафиксированной первой недели, но не может незаметно расширить бесплатный период.

Если расписание группы не опубликовано, не совпадает с текущим `OFFER_ACADEMIC_YEAR/OFFER_SEMESTER`, не содержит ни одного валидного занятия или первая неделя уже закончилась, новый trial не создаётся.

## Subscription record

Trial использует `version: 2` и существующую token storage схему. Новые поля additive.

```json
{
  "version": 2,
  "status": "active",
  "entitlement": "trial",
  "university": "kgmu",
  "program": "pediatrics",
  "course": 1,
  "groupCode": "131",
  "groupId": "kgmu:pediatrics:1:131",
  "groupDisplayName": "Группа 131",
  "academicYear": "2026/2027",
  "semester": 1,
  "plan": "semester",
  "trialStartDate": "2026-09-01",
  "trialEndDateExclusive": "2026-09-08",
  "conversionId": "<unguessable non-secret id>",
  "expiresAt": "<semester end>",
  "createdAt": "<ISO timestamp>"
}
```

`plan: "semester"` сохраняется как period selector для существующего schedule lookup; entitlement определяется отдельным полем и не выводится из plan.

Paid record:

```json
{
  "version": 2,
  "status": "active",
  "entitlement": "paid",
  "plan": "semester | year"
}
```

Для исторических paid records отсутствие `entitlement` эквивалентно `entitlement: "paid"`.

## Conversion context

Для перехода trial → offer используется отдельный непривилегированный `conversionId`. Он не даёт доступ к ICS и не содержит subscription token.

Хранилище:

```text
trial-conversions/<sha256(conversionId)>.json
```

Запись содержит безопасный контекст:

```json
{
  "version": 1,
  "conversionIdHash": "<sha256>",
  "trialTokenHash": "<sha256>",
  "status": "active",
  "university": "kgmu",
  "program": "pediatrics",
  "course": 1,
  "groupCode": "131",
  "groupId": "kgmu:pediatrics:1:131",
  "academicYear": "2026/2027",
  "semester": 1,
  "trialStartDate": "2026-09-01",
  "trialEndDateExclusive": "2026-09-08",
  "attribution": {
    "source": null,
    "medium": null,
    "campaign": null,
    "content": null,
    "referral": null
  },
  "createdAt": "<ISO timestamp>"
}
```

Raw trial token в conversion context не хранится.

## Public API

### POST `/api/v2/trials`

Создаёт trial только при `TRIALS_ENABLED=true` и только для реально опубликованной группы текущего offer period.

Request:

```json
{
  "university": "kgmu",
  "program": "pediatrics",
  "course": 1,
  "groupCode": "131",
  "groupId": "kgmu:pediatrics:1:131",
  "source": "vk",
  "medium": "post",
  "campaign": "fall-2026",
  "content": "creative-a",
  "referral": "starosta-131"
}
```

Response `201`:

```json
{
  "status": "active",
  "groupCode": "131",
  "trialStartDate": "2026-09-01",
  "trialEndDateExclusive": "2026-09-08",
  "subscriptionUrl": "https://.../api/v1/subscriptions/<trial-token>/calendar.ics",
  "conversionId": "<id>",
  "continueUrl": "https://gmarkov634-stack.github.io/kirov-gmu-calendar/?continue=<id>"
}
```

Ошибки fail-closed:

- `409 trials_not_open` — feature gate выключен;
- `404 offer_not_found` — опубликованной группы текущего периода нет;
- `409 trial_not_ready` — расписание не даёт валидного первого занятия;
- `409 trial_window_closed` — фиксированная первая учебная неделя уже закончилась;
- `400 invalid_trial_context` — невалидный request.

### GET `/api/v2/trials/continue/{conversionId}`

Возвращает только безопасный group/offer context. Subscription URL и raw token не возвращаются.

Используется лендингом, чтобы ссылка из promo event сразу открывала оффер той же группы без повторного выбора факультета/курса/группы.

## Tokenized calendar endpoint

Маршрут остаётся тем же:

```text
GET /api/v1/subscriptions/{token}/calendar.ics
```

Для `entitlement=paid` поведение сохраняется без изменений.

Для `entitlement=trial` endpoint:

1. читает текущую опубликованную schedule version;
2. проверяет schedule context так же строго, как paid;
3. фильтрует только события сохранённого `[trialStartDate, trialEndDateExclusive)`;
4. добавляет одно синтетическое conversion event;
5. генерирует ICS существующим builder;
6. записывает access observation существующим механизмом.

Никакие derived-поля исходных занятий не пересчитываются после фильтрации. `X из N`, academic week, next_same_event и другие значения остаются рассчитанными по полному расписанию группы, потому что trial — это view полного продукта, а не отдельное расписание.

## Conversion event

В trial feed допускается ровно одно синтетическое all-day событие на `trialEndDateExclusive`:

```text
SUMMARY: Продолжить календарь на семестр
DESCRIPTION: Первая бесплатная неделя закончилась. Подключить календарь своей группы на весь семестр: <continueUrl>
```

Событие создаётся только на feed projection и не записывается в canonical schedule/current.json.

UID детерминирован от `conversionId`, чтобы повторные fetch не создавали новое событие. Synthetic event не участвует в subject counters, day counters, diff или canonical QA.

## Trial → paid

`POST /api/v2/payments` получает необязательный `conversionId`.

Если conversionId передан:

1. backend разрешает его в server-side conversion context;
2. group/university/period из conversion context становятся authoritative и должны совпасть с checkout request;
3. order получает `acquisitionPath: "trial_to_paid"`, `trialConversionIdHash` и attribution;
4. обычный YooKassa flow создаёт новый paid subscription token;
5. paid feed всегда остаётся полным paid feed купленного периода.

### Поведение linked trial после успешной оплаты

Предыдущее маркетинговое предположение «paid feed начинает события только после trial_end» отменяется как технически невыгодное: оно раскалывает один семестр на два календаря и удаляет историю первой недели после удаления trial.

Вместо этого после успешного fulfillment linked trial переводится в `status: "upgraded"` (либо эквивалентно отзывается с reason=`upgraded`) и на следующем refresh перестаёт выдавать учебные VEVENT. Paid feed содержит полный оплаченный период.

Это сохраняет два ключевых свойства:

- расшаренный trial token никогда не превращается в paid access;
- купленный календарь самодостаточен и не зависит от сохранения trial-календаря.

На success page пользователь всё равно получает явную инструкцию удалить бесплатный календарь после подключения paid. До следующего refresh возможен кратковременный визуальный дубль, поэтому E2E должен отдельно проверить переход и UX-инструкцию.

## Аналитика без отдельной tracking-системы на первом этапе

Существующий `subscription-access/<tokenHash>.json` уже хранит `firstSeenAt`, `lastSeenAt` и `totalRequests`. После добавления `entitlement` в access record можно надёжно получить серверные события:

- trial feed first fetch;
- paid feed first fetch.

Attribution сохраняется в conversion context и затем переносится в order.

UI-события (`landing_view`, `group_selected`, `trial_cta_clicked`, `checkout_started`, `paid_connect_clicked`) реализуются отдельным analytics endpoint/слоем после готовности trial backend. Они не должны блокировать выдачу календаря.

## Конфигурация

Новая переменная:

```text
TRIALS_ENABLED=false
```

Default — `false`.

`COMMERCIAL_SALES_ENABLED` и `TRIALS_ENABLED` независимы. Это позволяет тестировать trial в закрытом коммерческом режиме. Публичный `/api/v2/meta` должен отдавать безопасное `trials: open|closed`, чтобы frontend не мог открыть trial статической конфигурацией.

Даже при `TRIALS_ENABLED=true` endpoint остаётся fail-closed без опубликованного расписания текущего offer period.

## Безопасность и sharing

- Trial token имеет ту же энтропию и формат, что paid token.
- Raw token не пишется в Object Storage и analytics.
- Conversion ID не является правом доступа, но также должен быть случайным и неугадываемым.
- Один человек может создать несколько trial URL, однако все они показывают одно и то же фиксированное первое учебное окно. Без аккаунта невозможно надёжно доказать «один человек = один trial», поэтому v1 не вводит фиктивную защиту через cookies/email.
- Access monitoring не блокирует trial автоматически. Sharing остаётся диагностикой.
- При необходимости storage-abuse ограничивается на ingress/rate-limit уровне отдельно от entitlement логики.

## Изменения в коде, необходимые для реализации

1. `config.js`: `trialsEnabled`; `/api/v2/meta`: `trials`.
2. Новый `trial-service.js`: создание token/conversionId, вычисление фиксированного окна, запись subscription + conversion context.
3. `store.js`: put/get conversion context и возможность отметить linked trial как upgraded без raw token.
4. `app.js`: POST create trial, GET continue context, entitlement-aware subscription validation/projection, optional conversionId в payment request.
5. `yookassa.js`: перенос trial attribution в order и перевод linked trial в upgraded после fulfillment; direct purchase остаётся без изменений.
6. Новый pure helper `trial-projection.js`: date filtering и deterministic synthetic conversion event для canonical и legacy schedule shape без изменения stored canonical batch.
7. Access record: добавить `entitlement`, сохраняя default `paid` для старых subscriptions.
8. Frontend подключается только после backend regression PASS.

## Обязательные regression-тесты до включения TRIALS_ENABLED

1. Feature gate по умолчанию закрыт.
2. Trial невозможно создать для неопубликованной группы.
3. Trial невозможно создать для другого academic year/semester.
4. Trial window вычисляется по первой фактической дате занятия и равен ровно 7 календарным дням.
5. Повторный trial той же группы не расширяет окно.
6. Tokenized trial feed содержит только события окна + один conversion event.
7. Обновление canonical current внутри окна появляется по тому же trial URL.
8. Событие после trialEnd не появляется в trial feed.
9. Derived `X из N` не пересчитывается на урезанном наборе.
10. Старый paid subscription record без entitlement продолжает работать без изменений.
11. Новый paid record работает как раньше и содержит полный период.
12. conversion endpoint не возвращает raw subscription token.
13. Checkout с conversionId не может подменить группу/вуз/период.
14. Успешный trial_to_paid создаёт новый paid token, а trial token не получает paid entitlement.
15. После fulfillment linked trial перестаёт выдавать учебные события, paid feed содержит полный период.
16. Direct purchase без trial не меняет поведение.
17. Revoke/rotate существующих paid subscriptions остаются зелёными.
18. Полный API regression suite проходит до deployment.

## Критерий завершения backend trial

Шаг считается реализованным только когда:

- все новые regression-тесты проходят;
- полный существующий API suite проходит;
- `TRIALS_ENABLED=false` не меняет production behavior;
- preview/deployment с `TRIALS_ENABLED=true` подтверждает реальный сценарий `create trial → webcal/URL fetch → ограниченный ICS → conversion context`;
- затем отдельный E2E подтверждает `trial → test YooKassa → новый paid token → linked trial upgraded → полный paid ICS`.
