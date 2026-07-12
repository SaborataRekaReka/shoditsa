# Наблюдаемость

Pino пишет JSON с request ID, route, status, latency, app version и Git SHA; secrets redacted. `/api/v1/metrics` отдаёт Prometheus text только с `Authorization: Bearer $METRICS_TOKEN` и содержит request count/error/latency aggregates, active sessions, completed games и active revision. Внешний uptime monitor проверяет readiness.

Alerts: readiness недоступен 2 минуты; 5xx >5% за 5 минут; backup старше 26 часов; disk >80%; PostgreSQL unhealthy. Product events продолжают идти в Яндекс Метрику; server operation/ledger ID используется для дедупликации completion.
