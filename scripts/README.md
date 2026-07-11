# Скрипты

Скрипты сгруппированы по владельцу данных или операции:

- `anime/`, `games/`, `movies/`, `music/`, `series/` — доменные import/enrichment pipelines.
- `kinopoisk/` — сбор ID и импорт данных Кинопоиска.
- `assets/` — построение каталогов, загрузка и оптимизация изображений.
- `enrichment-agent/` — общее resumable-ядро AI enrichment и адаптеры.
- `shared/` — переиспользуемые санитайзеры, схемы и helpers.
- `diagnostics/` — валидация, метрики и screenshots.
- `deploy/` — упаковка и доставка сборки.
- `maintenance/` — обслуживание локального workspace и конфигурации.

Пользовательские entrypoints объявлены в корневом `package.json`. Superseded одноразовые скрипты находятся в `archive/legacy-scripts/`.