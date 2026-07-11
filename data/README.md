# Рабочие данные pipelines

- `reference/` — фиксированные source-of-truth списки ID.
- `examples/` — небольшие примеры входных seed-файлов.
- `kinopoisk/navigator/{movies,series}/` — ID, resumable state и diagnostics сборщика.
- `anime/` — checkpoints и diagnostics anime pipeline.
- `games/` — raw/cache/manual/logs игрового pipeline.
- `music/` — локальные raw/normalized данные музыки; каталог исключён из Git.
- `enrichment-agent/` — локальный state AI-агентов; каталог исключён из Git.

Runtime-файлы приложения находятся не здесь, а в `public/data/`.