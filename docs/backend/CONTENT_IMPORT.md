# Импорт контента

1. Получить production snapshot всех шести `items.json`, diagnosis vignettes и media. Нулевая music library запрещена.
2. Выполнить dry-run. Он проверяет режимы, ID, обязательные поля, числа, media URL, diagnosis coverage, counts, порядок и SHA-256.
3. Проверить `data/import-manifest.json`. Падение count более 5% блокирует apply без `--allow-count-drop`.
4. Выполнить apply. Создаётся immutable revision в статусе `ready`; active revision не меняется.
5. Экспортировать revision и сравнить семантически с источником.
6. Перенести media через `content:media:migrate --apply`; отчёт содержит source, checksum, bytes и public URL.
7. Активировать revision отдельной командой.
8. Materialize 90 прошлых и 30 будущих дней.

Baseline этого checkout: movie 1246, series 811, anime 1000, game 1000, music 409, diagnosis 120; total 4586. Общий checksum текущего snapshot: `def79836c719e5d77d7c56b1b7fa2acdb0e92b7ddfdd72dc84f3b618c9f54a28`.

Apply не удаляет старые revisions. Archive sessions продолжают ссылаться на прежние item versions.
