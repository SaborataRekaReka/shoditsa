# Города

Исходный набор импортируется только из `v2_final.json`:

```powershell
npm run data:build:cities -- "C:\Users\brene\Downloads\Telegram Desktop\v2_final.json"
```

Скрипт сохраняет исходный снимок в `data/cities/raw/v2_final.json`, нормализует 980 записей в `public/data/cities.generated.json` и `public/data/libraries/cities/items.json`, строит `search-index.json`, а компактный клиентский атлас пишет в `public/city-content/cities.json`. Общий `public/data/source.json` и сводка `public/data/libraries/cities/source.json` обновляются автоматически.
