# Стандарт добавления игрового режима

Новый режим не добавляется отдельным экраном или веткой маршрутизации. Он подключается как данные и набор правил к существующему игровому конвейеру.

1. Добавить идентификатор и capabilities в `packages/contracts/src/game-modes.ts`: порядок дня, каталог данных, period/difficulty policy, free play и варианты.
2. Добавить исчерпывающее правило pool/compare в `GAME_MODE_RULES` пакета `game-core` и покрыть self-compare, variant pool, search и result-text тестами.
3. Подготовить библиотеку `public/data/libraries/<dataDir>` для staging/import. Hosted runtime не должен читать её из браузера.
4. Добавить UI-описание в `apps/web/src/app/mode-presentation.ts`. Главная, профиль и порядок дня строятся из манифеста автоматически.
5. Если стандартной карточки попытки недостаточно, зарегистрировать renderer в `ATTEMPT_CARD_BY_MODE`; не создавать отдельный game screen.
6. Запускать режим через `POST /api/v1/games/start` с `mode` и при необходимости `variantKey`. Экран настройки — `/games/:mode`, серверная игра — `/sessions/:sessionId`, автономная — `/play/:mode`.
7. Выполнить `npm run lint`, `npm test`, `npm run build` и проверить, что production bundle не содержит закрытых answer datasets.
8. Проверить титульный экран, карточку и игровую сессию по [каноническому дизайн-гайду](../UI_DESIGN_GUIDELINES.md). Новый режим переиспользует общий shell, кнопки, билетные паттерны и responsive-контракт.

Запрещённые обходные пути: собственный localStorage-формат режима, отдельный history/router, клиентский выбор правильного ответа в hosted runtime, ручные копии списка режимов и публикация answer JSON.
