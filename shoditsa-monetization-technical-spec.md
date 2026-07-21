# «Сходится!» — техническое задание на монетизацию

Статус: implementation-ready specification  
Репозиторий: `SaborataRekaReka/shoditsa`  
Основа: актуальная ветка `main`, проверенная 19 июля 2026 года

## 0. Инструкция агенту, который будет реализовывать ТЗ

Работать последовательно по фазам. Не пытаться реализовать весь документ одним большим изменением.

Перед началом каждой фазы:

1. Проверить актуальное состояние перечисленных в фазе файлов.
2. Сопоставить ТЗ с последними изменениями репозитория и сохранить совместимость с ними.
3. Составить короткий план конкретных файлов и тестов.
4. Сначала внести изменения в БД и contracts, затем API, затем web UI, затем admin UI.
5. После фазы выполнить проверки из раздела «Обязательная проверка».
6. Не переходить к следующей фазе при падающих тестах или незакрытых acceptance criteria.

Ключевые ограничения:

- ежедневные игры, обычные подсказки и текущий игровой цикл остаются бесплатными;
- реальные деньги не начисляют билеты и не меняют награду за daily-сеанс;
- стоимость и состав продукта определяет сервер;
- успешный redirect после оплаты не подтверждает покупку; источником истины служит проверенный webhook или серверная проверка платформенной покупки;
- все платёжные мутации идемпотентны;
- гостевой пользователь может просматривать предложение, а оплачивать — после создания постоянного аккаунта;
- server runtime и автономная Yandex-сборка должны продолжать собираться после каждой фазы;
- платёжные секреты запрещено добавлять в `VITE_*`, git, ответы API, логи и клиентские bundles;
- существующие билеты, разблокированные периоды, статистика и сохранения пользователей должны сохраниться без миграции с потерями.

## 1. Цель

Добавить в «Сходится!» добровольную монетизацию без рекламы и продажи игрового преимущества.

Целевая система состоит из четырёх направлений:

1. **Клубный абонемент** — доступ на 30 или 365 дней.
2. **Спецпоказы** — тематические игровые паки, приобретаемые навсегда или доступные по активному абонементу.
3. **Чаевые кассиру** — добровольная разовая поддержка с косметическим признанием. Показывать только в случае победы.
4. **Свой сеанс / частные игры** — отдельная последующая фаза для персональных и корпоративных игр. Сначала создать отедльную траницу-лендиг "Корпоративным клиентам" Разместит ьв футере.

Первая коммерческая версия должна включать чаевыве и клубный абонемент. Спецпоказы, Yandex IAP и частные игры реализуются следующими фазами поверх общего commerce-слоя.

## 2. Зафиксированные продуктовые правила

### 2.1. Бесплатный доступ

Пользователь без покупки получает:

- все семь daily-режимов;
- все существующие обычные подсказки;
- текущую систему билетов, серий, grace passes и достижений;
- архив: сегодня и шесть предыдущих календарных дней по Москве;
- разблокировку периодов за заработанные билеты;
- свободную игру по текущей стоимости в билетах;
- базовую статистику и существующие challenge-ссылки.

### 2.2. Клубный абонемент

Продукты первой версии:

| Product ID | Название | Цена | Срок | Продление |
| --- | --- | ---: | ---: | --- |
| `club_30d` | Клубный билет на 30 дней | 199 ₽ | 30 суток | вручную |
| `club_365d` | Годовой клубный билет | 1 490 ₽ | 365 суток | вручную |

Цены являются стартовыми seed-данными и впоследствии редактируются через админку. Клиент не содержит захардкоженных денежных сумм.

Активный клубный абонемент даёт:

- возможность начинать новые archive-сессии с даты публичного запуска проекта;
- свободную игру в любом режиме без списания билетов, где `GAME_MODE_MANIFEST[mode].freePlay === true`;
- клубный бейдж в профиле;
- задел для доступа к платным спецпоказам;
- расширенную статистику во второй продуктовой итерации.

Ограничения:

- free-play по абонементу имеет `cost = 0`;
- `freePlayUsage.launches` продолжает увеличиваться для аналитики;
- free-play не начисляет билеты и не продлевает daily-серию;
- режимы `game` и `city` сохраняют текущий `freePlay: false` до отдельной QA-задачи;
- клубный доступ к периодам действует только пока активен абонемент;
- период, купленный за билеты через `period_entitlements`, остаётся постоянным;
- завершённые пользователем старые сессии остаются видны в истории после окончания абонемента;
- начать новую пропущенную игру старше бесплатного окна после окончания абонемента нельзя.

### 2.3. Спецпоказы

Эта возможность реализуется после стабильного запуска клуба.

- рекомендуемая цена одного пака: 99–199 ₽;
- отдельная покупка даёт постоянный entitlement на конкретный `packId`;
- активный клуб даёт временный доступ ко всем пакам с `includedInClub = true`;
- администратор имеет доступ ко всем пакам;
- игровые результаты пака не участвуют в daily attendance, full house, daily streak и ежедневной награде;
- первые N партий могут быть бесплатным preview, если это настроено для пака;
- завершение абонемента не удаляет прогресс пака;
- купленный отдельно пак остаётся доступным после завершения абонемента.

### 2.4. Чаевые

Продукты второй коммерческой версии:

- `tip_paper_99` — 99 ₽;
- `tip_silver_299` — 299 ₽;
- `tip_gold_699` — 699 ₽.

Чаевые не создают билеты и игровой доступ. Успешная покупка создаёт постоянный supporter entitlement соответствующего уровня. В профиле показывается максимальный полученный уровень.

### 2.5. Автопродление

В первой версии отсутствует. Интерфейс явно сообщает: «Продление только вручную». Добавление рекуррентных платежей требует отдельного решения, новой версии оферты и отдельного ТЗ.

## 3. Текущее состояние репозитория, которое нужно учитывать

### 3.1. Архитектура

- npm workspace monorepo;
- `apps/web` — React/Vite/TanStack Query/TanStack Router;
- `apps/api` — Fastify modular monolith;
- `packages/contracts` — TypeBox-схемы и TypeScript-типы;
- `packages/game-core` — игровые и экономические правила;
- `packages/database` — Drizzle/PostgreSQL;
- server runtime определяется через `MODE !== 'yandex'`;
- Yandex build использует hash history и локальное хранилище.

### 3.2. Экономика

Существуют:

- `wallet_accounts`;
- append-only `wallet_ledger`;
- `period_entitlements`;
- `free_play_usage`;
- `promo_codes` и `promo_redemptions`;
- серверные транзакции и `Idempotency-Key`;
- `startFreePlay`, `unlockPeriod`, `redeemPromo`;
- начисление билетов в `apps/api/src/modules/stats/rewards.ts`.

Commerce-слой запрещено реализовывать через `wallet_ledger`. Билеты и реальные платежи должны иметь разные таблицы, сервисы и причины операций.

### 3.3. Архив

Сейчас UI формирует ровно семь дат в `apps/web/src/App.tsx`. API `/api/v1/archive` возвращает завершённые сессии, а `startGame(kind: 'archive')` принимает любую прошлую дату. Серверная граница бесплатного архива отсутствует.

В рамках клуба необходимо:

- добавить серверную проверку archive entitlement;
- сохранить открытие уже завершённой собственной сессии;
- добавить API календаря, позволяющий показывать сыгранные и пропущенные даты;
- исключить возможность обхода paywall прямым вызовом `/api/v1/games/start`.

### 3.4. Спецпоказы

Спецпоказы используют тот же каталог, поиск ответа, сравнение и экран результата, что и базовые игровые режимы. Набор задаёт только последовательность канонических карточек и дополнительные подсказки; доступ к закрытым наборам проверяется централизованно.

Для платных спецпоказов потребуется:

- заменить проверку `actorRole === 'admin'` на централизованный access resolver;
- добавить отдельный `kind: 'pack'`;
- исключить pack-сессии из daily rewards и attendance;
- хранить прогресс прохождения пака отдельно от `daily_challenges`.

### 3.5. Аналитика

Существуют Яндекс Метрика и серверная очередь `client_events`. У `client_events.event_name` есть DB check с фиксированным набором значений. Новые commerce-события требуют синхронного изменения:

- TypeScript union в `apps/web/src/app/client-events.ts`;
- DB check constraint;
- admin/event UI, если там применяется allowlist;
- тестов batch endpoint.

## 4. План реализации

## Фаза 0. Product analytics и feature flags

Цель: подготовить интерфейс предложения и собрать интерес до подключения реального провайдера.

### 4.0.1. Конфигурация

Добавить в `packages/config/src/index.ts` и `.env.example`:

```env
COMMERCE_ENABLED=false
COMMERCE_PROVIDER=stub
COMMERCE_CURRENCY=RUB
COMMERCE_RETURN_URL=http://localhost:5173/purchase/return
COMMERCE_WEBHOOK_SECRET=
COMMERCE_SHOP_ID=
COMMERCE_SECRET_KEY=
ARCHIVE_FIRST_DATE=2026-07-01
FREE_ARCHIVE_DAYS=7
```

Правила:

- `FREE_ARCHIVE_DAYS` — integer от 1 до 31;
- `ARCHIVE_FIRST_DATE` — валидный `YYYY-MM-DD`, не позже текущей даты;
- `COMMERCE_PROVIDER=stub` разрешён в development/test;
- production не запускается с `COMMERCE_ENABLED=true` и `COMMERCE_PROVIDER=stub`;
- provider secrets обязательны только при включённой реальной оплате;
- `COMMERCE_RETURN_URL` должен относиться к trusted origin.

### 4.0.2. Meta response

Расширить `MetaResponse`:

```ts
commerce: {
  enabled: boolean
  provider: 'none' | 'stub' | 'web'
  currency: string
  archiveFirstDate: string
  freeArchiveDays: number
}
```

Не возвращать названия реального провайдера, shop ID и другие внутренние реквизиты, если они не нужны UI.

### 4.0.3. Экран клуба

Добавить маршрут `/club`.

Рекомендуемые файлы:

- `apps/web/src/features/commerce/ClubScreen.tsx`;
- `apps/web/src/features/commerce/ClubScreen.css`;
- `apps/web/src/features/commerce/ClubCard.tsx`;
- изменения в `apps/web/src/app/routes.ts`;
- изменения в `apps/web/src/app/router.tsx`;
- минимальная интеграция с `App.tsx` и профилем.

Экран показывает:

- обещание бесплатного daily-доступа;
- преимущества клуба;
- два продукта;
- «Продление только вручную»;
- состояние пользователя: гость / без клуба / активный клуб / истёкший клуб;
- при `COMMERCE_ENABLED=false` — кнопку «Хочу такой абонемент» без checkout.

Fake-door кнопка создаёт событие `club_interest_clicked`, показывает спокойное подтверждение и не просит платёжных данных.

### 4.0.4. Аналитические события

Добавить в `client_events`:

```text
club_screen_view
club_interest_clicked
archive_paywall_view
archive_paywall_clicked
checkout_started
checkout_returned
purchase_succeeded
purchase_failed
club_free_play_started
pack_opened
pack_paywall_view
```

Разрешённые properties:

- `productId`;
- `placement`;
- `mode`;
- `archiveAgeDays`;
- `orderStatus`;
- `providerCategory` без внутреннего provider ID;
- `isAuthenticated`;
- `hasClub`.

Запрещённые properties:

- email;
- имя;
- платёжный token;
- подпись webhook;
- checkout URL;
- полное тело ошибки провайдера;
- банковские данные.

Источником денежных отчётов служит `payment_orders`.

### Acceptance criteria фазы 0

- `/club` открывается напрямую, из профиля и после возврата назад;
- Yandex build собирается и не показывает неработающую кнопку оплаты;
- fake-door событие попадает в server events и Метрику;
- существующие экран профиля, архив и daily game не изменили поведение;
- `COMMERCE_ENABLED=false` полностью скрывает checkout.

## Фаза 1. Общий commerce-слой и web MVP клуба

### 4.1.1. Новые таблицы

Добавить таблицы в `packages/database/src/schema.ts` и создать Drizzle migration.

#### `commerce_products`

```ts
id: text primary key
kind: text not null // club, pack, tip
title: text not null
description: text not null
priceMinor: integer not null
currency: text not null
durationDays: integer nullable
entitlementKey: text nullable
scope: text nullable
enabled: boolean not null default true
sortOrder: integer not null default 0
metadata: jsonb not null default {}
createdAt: timestamptz not null
updatedAt: timestamptz not null
```

Constraints:

- `price_minor >= 0`;
- currency matches `^[A-Z]{3}$`;
- kind is one of `club`, `pack`, `tip`;
- club requires positive `durationDays` and `entitlementKey = 'club'`;
- pack requires `scope`;
- product ID стабилен и не переиспользуется для продукта с другой семантикой.

#### `payment_orders`

```ts
id: uuid primary key
userId: uuid not null references user on delete cascade
productId: text not null references commerce_products
provider: text not null
status: text not null // created, pending, paid, failed, canceled, expired, refunded, chargeback
amountMinor: integer not null
currency: text not null
idempotencyKey: uuid not null
providerPaymentId: text nullable
providerStatus: text nullable
metadata: jsonb not null default {}
createdAt: timestamptz not null
updatedAt: timestamptz not null
paidAt: timestamptz nullable
closedAt: timestamptz nullable
```

Constraints/indexes:

- unique `(user_id, idempotency_key)`;
- unique `(provider, provider_payment_id)` where provider ID is not null;
- indexes `(user_id, created_at desc)` and `(status, updated_at)`;
- amount and currency copy from product at order creation and never trust client values.

#### `payment_events`

```ts
id: uuid primary key
provider: text not null
providerEventId: text not null
eventType: text not null
payloadHash: text not null
payload: jsonb not null default {}
status: text not null // received, processed, ignored, failed
errorCode: text nullable
receivedAt: timestamptz not null
processedAt: timestamptz nullable
```

Constraints:

- unique `(provider, provider_event_id)`;
- payload содержит только необходимый и очищенный набор полей;
- повторный webhook возвращает success и не создаёт повторный entitlement.

#### `user_entitlements`

```ts
id: uuid primary key
userId: uuid not null references user on delete cascade
entitlementKey: text not null // club, pack, supporter
scope: text nullable // packId, supporter level etc.
status: text not null // active, revoked, expired
startsAt: timestamptz not null
endsAt: timestamptz nullable
sourceType: text not null // order, admin, promo, migration, yandex
sourceId: text not null
metadata: jsonb not null default {}
createdAt: timestamptz not null
updatedAt: timestamptz not null
revokedAt: timestamptz nullable
```

Constraints/indexes:

- unique `(source_type, source_id, entitlement_key, coalesce(scope, ''))` либо эквивалентный unique index;
- index `(user_id, entitlement_key, status, ends_at)`;
- permanent entitlement имеет `endsAt = null`;
- entitlement активен, если `status = 'active'`, `startsAt <= now` и `endsAt is null or endsAt > now`.

`period_entitlements` остаётся без изменений.

### 4.1.2. Seed products

Создать идемпотентный seed или migration insert для:

```json
[
  {
    "id": "club_30d",
    "kind": "club",
    "title": "Клубный билет на 30 дней",
    "priceMinor": 19900,
    "currency": "RUB",
    "durationDays": 30,
    "entitlementKey": "club",
    "enabled": true
  },
  {
    "id": "club_365d",
    "kind": "club",
    "title": "Годовой клубный билет",
    "priceMinor": 149000,
    "currency": "RUB",
    "durationDays": 365,
    "entitlementKey": "club",
    "enabled": true
  }
]
```

Все суммы хранятся в minor units.

### 4.1.3. Серверные сервисы

Создать:

```text
apps/api/src/modules/commerce/
  routes.ts
  service.ts
  entitlements.ts
  products.ts
  providers/
    types.ts
    stub.ts
```

Интерфейс провайдера:

```ts
type CreatePaymentInput = {
  orderId: string
  amountMinor: number
  currency: string
  description: string
  returnUrl: string
  idempotencyKey: string
  metadata: { userId: string; productId: string }
}

type CreatePaymentResult = {
  providerPaymentId: string
  status: 'pending' | 'paid'
  checkoutUrl: string | null
  rawStatus: string
}

interface CommerceProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  parseAndVerifyWebhook(rawBody: Buffer, headers: Record<string, unknown>): Promise<VerifiedPaymentEvent>
  getPayment(providerPaymentId: string): Promise<VerifiedPaymentState>
}
```

`stub` provider:

- доступен только development/test;
- создаёт pending order;
- предоставляет test-only endpoint подтверждения;
- никогда не регистрируется в production;
- позволяет integration и E2E тестам прогнать полный поток без внешнего API.

### 4.1.4. Выдача entitlement

Создать единственную функцию, через которую выдаётся доступ:

```ts
grantProductEntitlement(tx, {
  userId,
  order,
  product,
  occurredAt,
})
```

Для club:

1. Заблокировать релевантные активные club entitlements пользователя в транзакции.
2. Найти максимальный `endsAt` среди действующих и будущих активных grant.
3. `startsAt = max(occurredAt, maximumEndsAt)`.
4. `endsAt = startsAt + durationDays * 24 hours`.
5. Создать grant с уникальным `sourceId = order.id`.
6. Повторный вызов с тем же order возвращает ранее созданный grant.

Срок измеряется точными сутками от момента платежа. UI показывает локализованную дату окончания; сервер хранит UTC timestamp.

Создать helpers:

```ts
getActiveEntitlements(db, userId, now?)
hasEntitlement(db, userId, key, scope?, now?)
getMembershipSummary(db, userId, now?)
```

Не хранить производный boolean `isClub` в `player_profiles`.

### 4.1.5. API

Добавить contracts и endpoints.

#### `GET /api/v1/commerce/catalog`

Доступен гостю.

```ts
type CommerceCatalogResponse = {
  enabled: boolean
  currency: string
  products: Array<{
    id: string
    kind: 'club' | 'pack' | 'tip'
    title: string
    description: string
    priceMinor: number
    currency: string
    durationDays: number | null
    metadata: Record<string, unknown>
  }>
}
```

Возвращаются только enabled products. Не возвращать provider IDs и служебные entitlement-настройки.

#### `GET /api/v1/me/commerce`

Требует сессию, разрешён anonymous user для показа состояния.

```ts
type MeCommerceResponse = {
  membership: {
    active: boolean
    startsAt: string | null
    endsAt: string | null
    source: 'order' | 'admin' | 'promo' | 'migration' | null
  }
  entitlements: Array<{
    key: string
    scope: string | null
    startsAt: string
    endsAt: string | null
  }>
}
```

#### `POST /api/v1/commerce/checkout`

Headers: `Idempotency-Key` required.  
Body:

```json
{ "productId": "club_30d" }
```

Правила:

- постоянный аккаунт обязателен;
- anonymous user получает `403 COMMERCE_ACCOUNT_REQUIRED`;
- disabled commerce: `503 COMMERCE_DISABLED`;
- неизвестный/выключенный продукт: `404 PRODUCT_NOT_AVAILABLE`;
- сервер копирует цену из product row;
- повтор с тем же ключом возвращает тот же order и checkout URL/state;
- provider timeout не создаёт второй provider payment при retry;
- rate limit: не более 10 checkout starts на пользователя в час.

Response:

```ts
type CheckoutResponse = {
  order: {
    id: string
    productId: string
    status: string
    amountMinor: number
    currency: string
    createdAt: string
  }
  checkoutUrl: string | null
}
```

#### `GET /api/v1/commerce/orders/:orderId`

- пользователь может читать только собственный order;
- возвращает status и продукт;
- provider raw data не возвращается.

#### `POST /api/v1/commerce/webhooks/:provider`

- public endpoint без cookie auth;
- signature verification обязательна;
- нужен raw request body;
- rate limit по IP и размер тела не более 128 KiB;
- сначала сохраняется `payment_event`, затем в транзакции меняется order и выдаётся entitlement;
- `paid` — терминальное успешное состояние;
- `refunded/chargeback` отзывает entitlement, созданный соответствующим order;
- duplicate webhook отвечает 200;
- неизвестный provider ID логируется как ignored без выдачи доступа;
- секреты и подписи редактируются в логах.

#### Development-only endpoint

```text
POST /api/v1/commerce/test/orders/:orderId/confirm
```

Доступен только при `NODE_ENV !== production` и `COMMERCE_PROVIDER=stub`. Желательно ограничить admin role или test header.

### 4.1.6. Изменение dashboard

Добавить в `DashboardResponse` короткое состояние:

```ts
membership: {
  active: boolean
  endsAt: string | null
}
```

Полный список entitlements остаётся в `/me/commerce`.

### 4.1.7. Архивный access control

Создать `apps/api/src/modules/archive/access.ts`:

```ts
getFreeArchiveStart(today, freeArchiveDays): string
canStartArchiveSession(db, userId, puzzleDate, config, now?): Promise<{
  allowed: boolean
  source: 'free-window' | 'club' | 'existing-session'
  freeFrom: string
}>
```

Правила `startGame(kind: 'archive')`:

- будущая дата запрещена как сейчас;
- дата раньше `ARCHIVE_FIRST_DATE` запрещена;
- дата внутри бесплатного окна разрешена;
- старая дата разрешена при активном club entitlement;
- ранее созданная пользователем сессия на этот challenge может быть прочитана независимо от текущего клуба;
- новая старая сессия без клуба: `403 ARCHIVE_CLUB_REQUIRED` с details `{ archiveDate, freeFrom }`;
- проверка выполняется сервером до создания `daily_challenge` и `game_session`.

Добавить:

#### `GET /api/v1/archive/calendar`

Query:

```ts
mode: PlayableMode
from: YYYY-MM-DD
to: YYYY-MM-DD
period?: PeriodKey
difficulty?: DifficultyKey
```

Ограничить диапазон одним запросом до 62 дней.

Response:

```ts
type ArchiveCalendarResponse = {
  access: {
    archiveFirstDate: string
    freeFrom: string
    clubActive: boolean
  }
  items: Array<{
    date: string
    access: 'free' | 'club' | 'locked'
    session: ArchiveItem | null
  }>
}
```

Сервер генерирует календарные даты, затем присоединяет последнюю сессию пользователя для выбранной комбинации. Ответ не содержит answer ID.

Существующий `/api/v1/archive` сохранить для истории профиля и обратной совместимости.

### 4.1.8. Free-play клуба

Изменить `startFreePlay`:

1. Сохранить проверку `FREE_PLAY_MODE_IDS`.
2. После idempotency replay определить активный club entitlement.
3. Всегда обновлять `free_play_usage.launches`.
4. Для клуба установить `cost = 0`, не блокировать wallet и не создавать `wallet_ledger` spend entry.
5. Создать game session как `kind = 'free_play'`.
6. Для обычного пользователя сохранить текущую формулу `45 + launches * 15` и текущую транзакционную логику.

Изменить `FreePlayResponse`:

```ts
type FreePlayResponse = GameSessionSnapshot & {
  cost: number
  balanceAfter: number
  ledgerId: string | null
  accessSource: 'tickets' | 'club'
}
```

При клубном старте `balanceAfter` равен текущему балансу, `ledgerId = null`.

На клиенте:

- показывать «По клубному абонементу» вместо количества билетов;
- не создавать локальную имитацию ledger operation в server runtime;
- после старта инвалидировать dashboard и commerce state;
- отправить `club_free_play_started`.

### 4.1.9. Checkout UI

Добавить:

```text
apps/web/src/features/commerce/
  ClubScreen.tsx
  CheckoutButton.tsx
  PurchaseReturnScreen.tsx
  MembershipBadge.tsx
  commerce.css
```

Поведение `CheckoutButton`:

- защита от двойного клика;
- один UUID idempotency key живёт до success/error, допускающего новый запрос;
- для гостя: переход `/register?next=/club&product=club_30d`;
- после регистрации восстановить выбранный product ID;
- после создания order перейти на server-provided checkout URL;
- если checkout URL отсутствует и order уже paid, обновить membership.

`PurchaseReturnScreen`:

- принимает только `orderId`;
- не принимает amount/status/product от query string;
- запрашивает order у API;
- при pending опрашивает endpoint каждые 2 секунды до 60 секунд;
- состояния: проверяем / оплачено / всё ещё обрабатывается / отменено / ошибка;
- после success инвалидирует `queryKeys.dashboard`, `queryKeys.commerce`, `queryKeys.archive`;
- показывает CTA «Перейти в клуб».

В профиле:

- у активного пользователя показывать badge и дату окончания;
- у остальных — карточку клуба;
- рядом с билетами не смешивать цену абонемента и баланс.

В архиве:

- бесплатные даты выглядят как сейчас;
- старые даты помечены замком;
- клик по locked дате открывает спокойный paywall sheet;
- после покупки пользователь возвращается к исходной дате и режиму;
- календарь загружается по месяцам или порциями, без рендера тысяч карточек сразу.

Текст paywall:

> Эта дата входит в полный архив клуба. Сегодня и предыдущие шесть дней доступны всем.

### 4.1.10. Admin UI

Добавить раздел «Монетизация» в существующую админку.

Минимальные подразделы:

1. **Продукты** — ID, название, тип, цена, валюта, срок, enabled.
2. **Заказы** — дата, пользователь, продукт, сумма, provider category, status, provider payment ID, paidAt.
3. **Доступы** — пользователь, entitlement, scope, начало, окончание, источник, status.

Admin endpoints:

```text
GET   /api/v1/admin/commerce/products
PATCH /api/v1/admin/commerce/products/:id
GET   /api/v1/admin/commerce/orders
GET   /api/v1/admin/commerce/entitlements
POST  /api/v1/admin/commerce/entitlements/grant
POST  /api/v1/admin/commerce/entitlements/:id/revoke
```

Все admin mutations:

- требуют причину;
- пишут `audit_log`;
- grant требует `Idempotency-Key`;
- ручной club grant имеет явный срок;
- admin не может менять `payment_orders.amountMinor` и подделывать paid status через UI.

### Acceptance criteria фазы 1

- бесплатный пользователь продолжает играть во все daily-режимы;
- бесплатный архив ограничен семью датами на сервере;
- direct API start старой даты возвращает `ARCHIVE_CLUB_REQUIRED`;
- после подтверждённой покупки `club_30d` доступ действует 30 суток;
- повторный webhook не продлевает доступ второй раз;
- повторный checkout с тем же idempotency key возвращает тот же order;
- две последовательные покупки складывают сроки;
- пользователь клуба начинает free-play с `cost = 0`, баланс и ledger не меняются;
- обычный free-play сохраняет текущую стоимость и ledger;
- возврат с checkout без webhook не выдаёт доступ;
- refunded order отзывает выданный им grant;
- гость перед оплатой направляется на регистрацию и возвращается к выбранному продукту;
- все admin changes попадают в audit log;
- feature flag позволяет задеплоить код с выключенной оплатой.

## Фаза 2. Спецпоказы и чаевые

### 4.2.1. Таблицы паков

Добавить:

#### `content_packs`

```ts
id: text primary key
slug: text unique not null
mode: content_mode not null
title: text not null
subtitle: text nullable
description: text not null
coverUrl: text nullable
status: text not null // draft, published, archived
accessModel: text not null // free, club, purchase
productId: text nullable references commerce_products
includedInClub: boolean not null default true
previewItems: integer not null default 0
manifestVersion: integer not null default 1
metadata: jsonb not null default {}
createdAt: timestamptz not null
updatedAt: timestamptz not null
```

#### `content_pack_entries`

```ts
packId: text references content_packs on delete cascade
position: integer not null
answerItemId: text not null references content_items
promptPayload: jsonb not null default {}
enabled: boolean not null default true
primary key (packId, position)
unique (packId, answerItemId)
```

#### `user_pack_progress`

```ts
userId: uuid references user on delete cascade
packId: text references content_packs on delete cascade
completedPositions: integer[] not null default []
lastPosition: integer nullable
startedAt: timestamptz not null
updatedAt: timestamptz not null
completedAt: timestamptz nullable
primary key (userId, packId)
```

Импортировать редакционные наборы в эти таблицы через идемпотентный шаг развёртывания. Исходный JSON хранить как версионируемый источник контента без дублирования карточек каталога.

### 4.2.2. Pack access resolver

```ts
canAccessPack(db, userId, packId, position, role, now?): Promise<{
  allowed: boolean
  source: 'admin' | 'free' | 'preview' | 'club' | 'purchase'
}>
```

Порядок:

1. admin;
2. published + free;
3. preview position;
4. permanent `pack` entitlement с `scope = packId`;
5. active club, если `includedInClub`;
6. deny `PACK_ACCESS_REQUIRED`.

### 4.2.3. Pack game session

Расширить `GameStartBodySchema`:

```ts
kind: 'daily' | 'archive' | 'pack'
packId?: string
packPosition?: number
```

Для `kind = 'pack'`:

- `packId` обязателен;
- `archiveDate` запрещён;
- period принудительно определяется паком или `all`;
- answer определяется `content_pack_entries.position`;
- сессия хранит pack ID и position отдельными nullable columns в `game_sessions` либо через отдельную relation;
- unique `(user_id, pack_id, pack_position)` защищает от дубликатов;
- `completeGame` не вызывает daily reward/attendance;
- после завершения транзакционно обновляется `user_pack_progress`;
- повторное открытие завершённой позиции возвращает существующий результат или явный replay flow;
- answer и закрытые подсказки не попадают в незавершённый snapshot.

Не использовать `daily_challenges` для последовательности платного пака.

### 4.2.4. Pack API/UI

```text
GET /api/v1/packs
GET /api/v1/packs/:packId
GET /api/v1/packs/:packId/progress
POST /api/v1/packs/:packId/sessions
```

Добавить маршруты:

- `/specials`;
- `/specials/:packId`.

Карточка пака показывает:

- цену или статус «В клубе»;
- прогресс;
- количество игр;
- preview;
- permanent ownership;
- явное пояснение, если доступ временный по клубу.

### 4.2.5. Чаевые

- добавить tip products в seed;
- checkout использует общий поток;
- после `paid` выдаётся permanent `supporter` entitlement со scope `paper`, `silver` или `gold`;
- профиль показывает максимальный уровень;
- повторная покупка допустима как поддержка, но один и тот же order обрабатывается один раз;
- supporter entitlement не участвует в игровых access checks.

### Acceptance criteria фазы 2

- пользователь может купить один pack и сохранить доступ после окончания клуба;
- пользователь клуба видит included pack без отдельной покупки;
- preview работает без оплаты и не открывает остальные позиции;
- pack game не начисляет билеты и не меняет daily streak/full house;
- прогресс пака сохраняется после окончания клуба;
- чаевые не меняют wallet;
- существующий DTF pack доступен по новой модели и не зависит от admin role в player flow.

## Фаза 3. Yandex Games purchases

Эта фаза начинается после стабилизации web commerce. Она не должна блокировать web MVP.

### 4.3.1. Текущая проблема

`apps/web/src/main.tsx` вызывает `YaGames.init()`, но теряет возвращённый SDK object. Тип в `vite-env.d.ts` содержит только `init`. Yandex runtime использует local controller и не имеет общего server account/commerce state.

### 4.3.2. SDK singleton

Добавить:

```text
apps/web/src/features/yandex/sdk.ts
apps/web/src/features/yandex/payments.ts
apps/web/src/features/yandex/player-data.ts
```

`sdk.ts` экспортирует одну cached promise и используется в `main.tsx`, авторизации, storage и payments.

Расширить typings только минимально необходимыми интерфейсами:

- `IProduct`;
- `IPurchase` / signed result;
- `payments.getCatalog()`;
- `payments.purchase()`;
- `payments.getPurchases()`;
- `payments.consumePurchase()`;
- player auth/data methods.

### 4.3.3. Рекомендуемый ассортимент Yandex MVP

Из-за отсутствия общего server account на первом шаге продавать:

- постоянные тематические паки;
- постоянный founder/lifetime product, если он будет утверждён отдельно;
- consumable tips.

Не продавать 30-дневный web club до реализации надёжной синхронизации срока через Yandex player data или server verification.

### 4.3.4. Обработка покупок

- permanent purchases не consume;
- consumable tip сначала фиксируется в player cloud data, затем consume;
- на каждом запуске выполнять reconciliation через `getPurchases()`;
- UI получает название валюты и цену из Yandex catalog;
- не хардкодить RUB для Yandex;
- при ошибке сети покупка остаётся в состоянии «проверяем»;
- localStorage может быть cache, Yandex purchase state остаётся источником восстановления;
- при появлении общего backend linking перейти на signed server verification.

### Acceptance criteria фазы 3

- Yandex build проходит модерационный сценарий незавершённой покупки;
- permanent pack восстанавливается после очистки localStorage;
- consumable tip не начисляется повторно при перезапуске;
- закрытие purchase iframe не показывает success;
- web и Yandex продукты имеют стабильное внутреннее product mapping;
- цены и валюта в Yandex UI приходят из catalog API.

## Фаза 4. «Свой сеанс» и корпоративные игры

Реализовать после проверки спроса через ручную форму.

### 4.4.1. MVP ручного заказа

- публичная страница `/create-a-game` с описанием и формой заявки;
- форма не принимает оплату внутри игры на первом шаге;
- заявка попадает в отдельную admin queue;
- администратор вручную создаёт pack через существующий Game Builder;
- после готовности клиент получает private link/token;
- доступ к private pack отсутствует в публичном каталоге.

### 4.4.2. Будущие таблицы

```text
private_games
private_game_members
private_game_invites
private_game_orders
```

Обязательные свойства:

- owner user ID;
- pack ID;
- private/public/unlisted visibility;
- startsAt/endsAt;
- participant limit;
- hashed invite token;
- custom cover and title;
- moderation status;
- order/product reference;
- aggregate results without раскрытия персональных данных участникам без согласия.

### 4.4.3. Границы self-service

Первая self-service версия разрешает выбирать ответы только из активного каталога и писать дополнительные подсказки. Загрузка полностью произвольных объектов и изображений требует модерации, abuse tooling, copyright policy и отдельного security review.

## 5. Изменения contracts

Создать commerce-типы в `packages/contracts/src/commerce.ts` либо в существующих `api.ts`/`schemas.ts` с последующим экспортом из package index.

Минимальный набор:

```ts
CommerceProductKind
CommerceProduct
CommerceCatalogResponse
MembershipSummary
MeCommerceResponse
CheckoutBody
CheckoutResponse
PaymentOrderStatus
PaymentOrderPublic
OrderResponse
ArchiveCalendarQuery
ArchiveCalendarResponse
AdminCommerceProductPatch
AdminEntitlementGrantBody
AdminEntitlementRevokeBody
```

Все входные TypeBox schemas используют `additionalProperties: false`.

Обновить:

- `DashboardResponse`;
- `FreePlayResponse`;
- `MetaResponse`;
- позднее `GameStartBodySchema` и `GameSessionSnapshot.kind` для pack.

## 6. Ошибки API

Добавить стабильные codes:

```text
COMMERCE_DISABLED
COMMERCE_ACCOUNT_REQUIRED
COMMERCE_PROVIDER_UNAVAILABLE
PRODUCT_NOT_AVAILABLE
ORDER_NOT_FOUND
ORDER_ALREADY_CLOSED
PAYMENT_CREATION_FAILED
PAYMENT_SIGNATURE_INVALID
PAYMENT_EVENT_INVALID
PAYMENT_PENDING
ENTITLEMENT_NOT_FOUND
ENTITLEMENT_ALREADY_REVOKED
ARCHIVE_CLUB_REQUIRED
ARCHIVE_DATE_BEFORE_LAUNCH
PACK_NOT_FOUND
PACK_ACCESS_REQUIRED
PACK_POSITION_INVALID
```

Пользовательские сообщения должны описывать следующее действие. Provider error body пользователю не возвращать.

## 7. Поведение при сбоях

| Ситуация | Ожидаемое поведение |
| --- | --- |
| Пользователь закрыл оплату | Order остаётся pending/canceled, доступ не выдаётся |
| Redirect пришёл раньше webhook | Экран показывает «Проверяем оплату» и опрашивает order |
| Webhook пришёл раньше redirect | При открытии return page сразу показывается success |
| Provider повторил webhook | Возвращается 200, повторного grant нет |
| API упал после provider create | Retry с тем же key восстанавливает order/provider payment |
| Две вкладки запустили checkout | Разные keys создают разные orders; одинаковый key — один order |
| Пользователь купил 30 дней дважды | Второй срок начинается после конца уже оплаченного срока |
| Абонемент закончился во время free-play | Уже созданная session продолжается; новый бесплатный start запрещён |
| Абонемент закончился во время archive game | Уже созданная session остаётся доступной |
| Refund | Grant соответствующего order отзывается; другие grants сохраняются |
| Provider недоступен | Daily game работает; checkout показывает временную ошибку |

## 8. Безопасность и приватность

- server-authoritative price, order status и entitlements;
- webhook signature verification до изменения order;
- payment event idempotency и database uniqueness;
- raw-body verification без повторного JSON serialization;
- redaction новых полей `signature`, `paymentToken`, `providerPayload`, `secretKey` в Fastify logger;
- минимизация сохраняемого provider payload;
- запрет checkout для blocked user;
- ownership checks для order, private game и pack progress;
- отдельные rate limits для checkout, order polling и webhook;
- CSP корректируется только под реально выбранный redirect/widget provider;
- никаких provider scripts до включения commerce feature flag;
- удаление аккаунта каскадно удаляет локальные коммерческие сущности, финансовые записи сохраняются или анонимизируются согласно юридическим требованиям провайдера — решение требуется перед production launch;
- перед production launch подготовить условия оплаты, политику возвратов, privacy policy и проверить права на коммерческое использование изображений и источников данных.

## 9. Тесты

### 9.1. Unit

Создать тесты для:

- active/expired/permanent entitlement;
- последовательного продления клуба;
- idempotent grant;
- product validation;
- archive free window;
- archive club access;
- club free-play cost;
- provider webhook parsing/signature adapter;
- order state transitions;
- pack access priority.

### 9.2. Integration

Расширить `apps/api/test`:

- anonymous catalog read;
- anonymous checkout rejection;
- checkout price cannot be overridden;
- checkout idempotency;
- stub confirmation → paid order → one entitlement;
- duplicate confirmation/webhook;
- refund/revoke;
- stacking 30d + 365d;
- free archive boundary;
- direct old archive start blocked;
- club old archive start allowed;
- ordinary free-play wallet debit unchanged;
- club free-play wallet/ledger unchanged;
- admin grant/revoke + audit log;
- answer leak tests для archive и pack sessions.

Предпочтительные существующие файлы для расширения:

- `apps/api/test/game.integration.test.ts`;
- `apps/api/test/account-lifecycle.integration.test.ts`;
- `apps/api/test/admin.integration.test.ts`;
- `apps/api/test/answer-leak.integration.test.ts`;
- новый `apps/api/test/commerce.integration.test.ts`.

### 9.3. Web component/unit

- ClubScreen states;
- redirect guest → registration → selected product restored;
- CheckoutButton double click;
- PurchaseReturn pending/paid/failed;
- archive locked/free/club cards;
- MembershipBadge expiry rendering;
- client event queue accepts new events.

### 9.4. E2E

Добавить сценарии:

1. Зарегистрированный пользователь открывает ClubScreen.
2. Покупает `club_30d` через stub.
3. Возвращается на PurchaseReturnScreen.
4. Видит active membership в профиле.
5. Открывает старую дату.
6. Начинает free-play с `cost = 0`.
7. После test expiry снова видит locked archive и билетную цену free-play.

Отдельно проверить, что guest daily E2E продолжает проходить.

## 10. Обязательная проверка после каждой фазы

Запустить:

```bash
npm run db:generate
npm run db:migrate
npm run db:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run build:api
npm run yandex:build
```

Перед release дополнительно:

```bash
npm run test:e2e
npm run data:validate
npm run smoke
```

Если integration/E2E требуют PostgreSQL и active content revision, поднять окружение по текущему README. Не ослаблять тесты ради прохождения.

## 11. Рекомендуемый порядок pull requests / локальных checkpoints

1. `commerce-contracts-and-schema` — config, tables, migration, contracts, seed, unit tests.
2. `commerce-api-stub` — provider abstraction, catalog, checkout, order, webhook/test confirmation, integration tests.
3. `club-access` — entitlements в dashboard, archive guard/calendar, free-play cost zero, integration tests.
4. `club-ui` — routes, ClubScreen, profile badge, archive locks, return flow, component/E2E tests.
5. `commerce-admin` — products, orders, entitlements, audit.
6. `real-web-provider` — sandbox adapter, webhook verification, production config.
7. `content-packs` — pack tables/import/access/session/progress/UI.
8. `tips` — tip products и supporter badge.
9. `yandex-purchases` — SDK singleton, catalog, reconciliation, cloud persistence.
10. `private-games-mvp` — заявка и ручное производство.

Каждый checkpoint должен быть самостоятельно собираемым и иметь выключенный по умолчанию feature flag, пока пользовательский поток не завершён целиком.

## 12. Definition of Done первой коммерческой версии

Версия готова к ограниченному production rollout, когда:

- реальный provider adapter прошёл sandbox и production test payment;
- webhook проверяется криптографически;
- paid order выдаёт ровно один entitlement;
- archive и free-play проверяют entitlement на сервере;
- бесплатный daily flow работает без commerce provider;
- оплата доступна только постоянному аккаунту;
- пользователь видит цену, срок и ручное продление до checkout;
- refund path проверен;
- admin видит продукты, заказы и доступы;
- новые события доступны в аналитике;
- нет платёжных секретов в frontend bundle и логах;
- web, API и Yandex build проходят проверки;
- выполнен backup БД до migration и описан rollback feature flag;
- опубликованы пользовательские правила оплаты и возврата.

## 13. Отдельные решения, которые владелец проекта принимает перед подключением реальных платежей

Эти решения не блокируют schema/API/stub implementation:

1. Платёжный провайдер для юридического статуса и страны регистрации владельца.
2. Точная дата `ARCHIVE_FIRST_DATE`.
3. Production цены и валюта web products.
4. Правила возврата уже использованного цифрового доступа.
5. Срок хранения финансовых записей после удаления аккаунта.
6. Нужен ли lifetime/founder product.
7. Входит ли каждый будущий тематический пак в клуб.
8. Будет ли Yandex-покупка связываться с web-аккаунтом.

До этих решений локальный агент должен реализовать provider-neutral core и `stub`, сохранив `COMMERCE_ENABLED=false` по умолчанию.
