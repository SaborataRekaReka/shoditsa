# Подключение generic pack prompts к `games/service.ts`

Файл `pack-prompt-runtime-helper.ts` рассчитан на размещение по адресу:

```text
apps/api/src/modules/packs/prompt-runtime.ts
```

После этого импортируйте его в `apps/api/src/modules/games/service.ts`:

```ts
import { loadPackSessionPrompt } from '../packs/prompt-runtime.js'
```

## 1. Снимок сессии

В `buildSessionSnapshot()` после загрузки `answer` добавьте:

```ts
const packPrompt = session.kind === 'pack'
  ? await loadPackSessionPrompt(tx, {
      packId: session.packId,
      packPosition: session.packPosition,
      attemptsCount: session.attemptsCount,
    })
  : null

const legacyPromo = await promoSessionPayload(
  sessionMode,
  challengeVariant,
  answer,
  session.attemptsCount,
)

const promptRuntime = packPrompt ?? legacyPromo
const isPromptSession = Boolean(packPrompt) || isPromoSession
const maxAttempts = packPrompt?.maxAttempts ?? 10
```

Затем замените соответствующие поля результата:

```ts
attemptsRemaining: Math.max(0, maxAttempts - session.attemptsCount),
maxAttempts,
hintChoices: isPromptSession ? [] : choices,
hintOptions: isPromptSession
  ? []
  : hintOptions.map(({ key, title, subtitle }) => ({ key, title, subtitle })),
progressiveHints: promptRuntime.progressiveHints,
promoPrompt: promptRuntime.promoPrompt,
```

Текущий `promoSessionPayload()` можно оставить для старого
`dtf-games-promo-30-v1`. Generic helper будет применяться ко всем сессиям
`kind = "pack"`.

## 2. Лимит в шесть попыток

В начале `submitAttempt()` после получения и блокировки сессии загрузите
настройки пакета:

```ts
const packPrompt = session.kind === 'pack'
  ? await loadPackSessionPrompt(tx, {
      packId: session.packId,
      packPosition: session.packPosition,
      attemptsCount: session.attemptsCount,
    })
  : null

const maxAttempts = packPrompt?.maxAttempts ?? 10

if (session.attemptsCount >= maxAttempts) {
  throw new ApiError(
    409,
    'GAME_ATTEMPTS_EXHAUSTED',
    'Попытки закончились',
  )
}
```

Замените вычисление статуса:

```ts
const position = session.attemptsCount + 1
const status = isCorrect
  ? 'won'
  : position >= maxAttempts
    ? 'lost'
    : 'playing'
```

После попытки нужно повторно получить видимые комментарии уже для нового
`position`:

```ts
const promptAfterAttempt = packPrompt
  ? await loadPackSessionPrompt(tx, {
      packId: session.packId,
      packPosition: session.packPosition,
      attemptsCount: position,
    })
  : null

const legacyPromoAfterAttempt = promptAfterAttempt
  ? null
  : await promoSessionPayload(
      sessionMode,
      variantKey,
      answer,
      position,
    )

const runtimeAfterAttempt = promptAfterAttempt ?? legacyPromoAfterAttempt
```

В ответе API:

```ts
session: {
  status,
  attemptsCount: position,
  attemptsRemaining: Math.max(0, maxAttempts - position),
  maxAttempts,
},
progressiveHints: runtimeAfterAttempt?.progressiveHints ?? [],
promoPrompt: runtimeAfterAttempt?.promoPrompt ?? null,
```

Ограничение базы данных уже допускает значения попыток от 1 до 10, поэтому
для лимита 6 отдельная миграция не требуется.

## 3. Контракт API

В `GameSessionSnapshot` и кратком объекте `session` ответа попытки добавьте:

```ts
maxAttempts?: number
```

Поле опциональное, чтобы старые клиенты продолжали считать лимит равным 10.

## 4. Клиент

Во всех местах, где интерфейс выводит литерал `10`, используйте:

```ts
const maxAttempts = session.maxAttempts ?? 10
```

Это относится к:

- прогресс-бару;
- строке `Попытка N из M`;
- оставшимся попыткам;
- счётчику истории;
- условию финального поражения.

## 5. Пять игр за один заход

JSON содержит пять фиксированных наборов по пять игр в
`pack.playSets`. Базовый `content_packs` сейчас хранит прогресс по отдельным
позициям, поэтому наборы не требуют изменения таблиц.

Для промо-страницы достаточно:

1. прочитать `playSets` из `content_packs.metadata`;
2. открыть `promo-1` для первого захода;
3. после завершения позиции открыть следующую позицию того же набора;
4. после пятой игры сформировать общий результат;
5. следующий набор разблокировать после завершения предыдущего.

Награда `free_play_credit` и бейдж идеального результата описаны в JSON как
продуктовая спецификация. В текущей экономике отдельного типа ваучера нет,
поэтому эти две награды требуют отдельной серверной операции.
