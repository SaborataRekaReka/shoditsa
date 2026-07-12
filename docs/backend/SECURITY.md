# Безопасность

- Secrets валидируются при startup и не имеют `VITE_` prefix.
- Cookie sessions: HttpOnly, Secure production, SameSite Lax, Path `/` (Better Auth).
- Better Auth trusted origins и CSRF остаются включены; password hashing делегирован Better Auth.
- Fastify валидирует JSON Schema, ограничивает body/rate и возвращает стабильный error envelope.
- Логи Pino redact cookie, authorization, password, promo code и set-cookie.
- Helmet включает nosniff/referrer/permissions и CSP report-only; HSTS включается production-конфигурацией.
- PostgreSQL находится только во внутренней Docker network; API process непривилегированный.
- Admin role читается только с server profile; initial allowlist берётся из `ADMIN_EMAILS`.
- Promo codes хранятся как HMAC-SHA256 с pepper. Destructive code `СОСО` запрещён.
- Wallet ledger append-only на уровне API и DB trigger.

До production необходимо проверить CSP reports/Yandex SDK, настроить SMTP, сменить все example secrets и выполнить dependency/security review. `npm audit` findings не исправляются force-командой без анализа breaking changes.
