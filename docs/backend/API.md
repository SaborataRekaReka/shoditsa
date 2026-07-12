# API v1

Канонические пути: `/api/v1/*` и `/api/auth/*`. JSON UTF-8, UUID server IDs, ISO UTC timestamps, Moscow `YYYY-MM-DD` game dates. Mutation требуют `Idempotency-Key`. Ошибка имеет envelope `{ error: { code, message, requestId, details } }`.

Основные группы:

- health/meta: `/health/live`, `/health/ready`, `/meta`;
- auth/profile: `/auth/guest`, `/me`, `/me/profile`, `/me/legacy-import`, Better Auth routes;
- catalog: `/catalog/search`, `/catalog/items/:itemId`;
- games: `/games/start`, `/games/:sessionId`, `/attempts`, `/hints`;
- archive/dashboard/wallet/stats/entitlements;
- economy: period unlock, free-play start, promo redeem;
- admin: revisions, daily salt, promos, adjustments, review.

Search с `sessionId` сам выбирает revision/pool и исключает использованные guesses. Attempt блокирует session row, проверяет owner/status/pool/duplicate/limit, рассчитывает hints и completion в одной transaction. Answer добавляется только при `won/lost`.

Полная сгенерированная OpenAPI 3.1: [openapi.json](openapi.json). Development Swagger UI: `/api/docs`; production UI выключен.
