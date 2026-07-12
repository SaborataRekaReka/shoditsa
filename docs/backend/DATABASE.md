# База данных

Источник схемы: `packages/database/src/schema.ts`. Первая forward-only migration находится в `packages/database/migrations`. Она включает `pg_trgm`, 28 таблиц, auth schema Better Auth, доменные ограничения и trigger, запрещающий UPDATE/DELETE `wallet_ledger`.

```mermaid
erDiagram
  user ||--|| player_profiles : has
  user ||--o{ session : authenticates
  content_revisions ||--o{ content_item_versions : versions
  content_items ||--o{ content_item_versions : identity
  content_item_versions ||--o{ content_aliases : aliases
  content_revisions ||--o{ daily_challenges : freezes
  daily_challenges ||--o{ game_sessions : starts
  user ||--o{ game_sessions : owns
  game_sessions ||--o{ game_attempts : records
  game_sessions ||--o{ game_hint_choices : opens
  user ||--|| wallet_accounts : owns
  user ||--o{ wallet_ledger : ledger
  user ||--o{ period_entitlements : unlocks
  promo_codes ||--o{ promo_redemptions : redeemed
```

Ключевые constraints: unique challenge variant; one user session per challenge; unique attempt position/guess/idempotency; maximum attempts check 0–10; unique operation key in ledger; non-negative wallet; one entitlement per mode/period; promo per-user numbering and request idempotency.

## Migration policy

Production changes только expand/contract. `npm run db:generate` создаёт SQL, `npm run db:migrate` применяет его, `npm run db:check` проверяет DB и active revision. Автоматический production down запрещён.
