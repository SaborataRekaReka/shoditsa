# API v1

Канонические пути: `/api/v1/*` и `/api/auth/*`. JSON UTF-8, UUID server IDs, ISO UTC timestamps, Moscow `YYYY-MM-DD` game dates. Mutation требуют `Idempotency-Key`. Ошибка имеет envelope `{ error: { code, message, requestId, details } }`.

Основные группы:

- health/meta: `/health/live`, `/health/ready`, `/meta`;
- auth/profile: `/auth/guest`, `/me`, `/me/profile`, `/me/legacy-import`, Better Auth routes;
- catalog: `/catalog/search`, `/catalog/items/:itemId`;
- games: `/games/start`, `/games/:sessionId`, `/attempts`, `/hints`, `/final-choice`;
- archive/dashboard/wallet/stats/entitlements;
- economy: period unlock, free-play start, promo redeem;
- admin: revisions, daily salt, promos, adjustments, review.

Search с `sessionId` сам выбирает revision/pool и исключает использованные guesses. Attempt блокирует session row, проверяет owner/status/pool/duplicate/limit, рассчитывает hints и completion в одной transaction. Answer добавляется только при терминальном статусе.

После последней неверной попытки catalog-режим переходит в `final_choice` и возвращает безопасный снимок четырёх карточек без ответа и награды. Исключения: Данетки и `dtf-game-comments-25-v1`.

`POST /games/:sessionId/final-choice` требует `Idempotency-Key` и принимает одно из действий:

```json
{ "action": "choose", "itemId": "content-item-id" }
```

```json
{ "action": "reveal" }
```

Первое итоговое действие переводит сессию в `won` или `lost`, записывает `completionType`, начисляет награду и возвращает правильный `answer`. Повтор с тем же ключом возвращает прежний ответ; другое действие после завершения получает `409 GAME_FINAL_CHOICE_ALREADY_RESOLVED`.

Полная сгенерированная OpenAPI 3.1: [openapi.json](openapi.json). Development Swagger UI: `/api/docs`; production UI выключен.
