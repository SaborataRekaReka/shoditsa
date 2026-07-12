# Архитектура серверной версии

Репозиторий является npm workspace-монорепозиторием:

- `apps/web` — React/Vite, TanStack Query, server UI и автономный Yandex fallback;
- `apps/api` — stateless Fastify modular monolith;
- `packages/contracts` — TypeBox runtime-схемы и выведенные API-типы;
- `packages/game-core` — детерминированные правила pool/daily/compare/search/economy;
- `packages/database` — Drizzle schema, migration и postgres.js client;
- `packages/config` — fail-fast startup configuration;
- `scripts/content` — import/export/activate/materialize/media migration;
- `infra` — Docker, Nginx, backup и systemd templates.

```mermaid
flowchart LR
  B["Browser"] -->|"/, /assets"| N["Host Nginx"]
  B -->|"/media"| N
  B -->|"/api/v1, /api/auth"| N
  N --> W["Immutable web release"]
  N --> M["Persistent media"]
  N --> A["Fastify API"]
  A --> P[("PostgreSQL 18")]
```

## Инварианты

- Незавершённый API payload не содержит answer ID, seed или закрытые подсказки.
- Все mutation используют UUID `Idempotency-Key`; уникальные DB constraints закрывают retries/concurrency.
- Daily date вычисляется в `Europe/Moscow` на сервере.
- Challenge закреплён за content revision и answer item version.
- Wallet меняется только транзакцией с append-only ledger.
- Web runtime не загружает `items.json`, `search-index.json` или `daily-config.json`.
- Yandex mode включается только `vite --mode yandex` и продолжает использовать автономный legacy client.

## Модули API

Auth отвечает за Better Auth и anonymous accounts; content — поиск и public cards; games — challenge/session/attempt/hints; stats — completion/streak/full-house/reward; economy — wallet/unlocks/free-play/promo; users — profile и legacy import; admin — revisions/settings/promos/wallet/review; health — liveness/readiness/meta.
