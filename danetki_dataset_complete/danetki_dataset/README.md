# Данетки: объединённый корпус

Дата сборки: 2026-07-20

## Состав

- Сырых карточек: **2010**
- Уникальных карточек после дедупликации: **1743**
- Объединено повторов: **267**
- Пар вопрос/ответ ведущего: **3064**
- Train/validation/test: **1567 / 100 / 76**

## Главные файлы

- `danetki_puzzles_full.jsonl` — канонический полный корпус.
- `danetki_puzzles_part_001.jsonl` и последующие — тот же корпус частями по 1000 записей.
- `danetki_writer_sft_train.jsonl` — тренировочный JSONL в формате `messages`.
- `danetki_host_qa_full.jsonl` — вопросы/догадки игроков и ответы `yes/no/irrelevant`.
- `custom_gpt_knowledge_part_*.md` — файлы, подготовленные для Knowledge в Custom GPT.
- `plot_fingerprints.md` — компактный индекс для проверки смысловых повторов.
- `sources_and_licenses.csv` — происхождение и режим использования источников.
- `stats.json` — точная статистика сборки.

## Рекомендуемая загрузка в Custom GPT

Загрузите все `custom_gpt_knowledge_part_*.md`, `plot_fingerprints.md` и этот README.
Полный JSONL нужен для программной обработки, обучения открытой модели и повторной фильтрации.

## Поля канонической записи

`id`, `title`, `condition`, `solution`, `language`, `translations`, `key_facts`,
`difficulty_10`, `tags`, `content_flags`, `quality_score`, `training_roles`, `split`,
`selected_text_license`, `selected_text_commercial_ready`, `provenance`,
`duplicate_cluster_size`, `alternate_formulations`.

## Дедупликация

Точные повторы объединены после нормализации Unicode и пунктуации. Англоязычные записи,
включая английские параллельные версии YesNoGame, дополнительно сгруппированы по
символьному TF-IDF с консервативным порогом 0.94. Исходники кластера сохранены в
`provenance`, а альтернативные формулировки — в `alternate_formulations`.

## Ограничения

Метки лицензий относятся к выбранным публичным источникам и не являются юридическим
заключением. Для коммерческого использования фильтруйте
`selected_text_commercial_ready=true` и самостоятельно проверяйте происхождение записей.
Автоматическая дедупликация может пропускать сильно перефразированные межъязыковые сюжеты.
